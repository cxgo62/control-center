# iStoreOS Read-Only Service Card Design

## Goal

Add a read-only iStoreOS router card to the `网络基建` section of the Services page. The first version answers two questions only: whether the router is reachable and whether its PassWall2/Xray proxy path is working.

The feature must not change the height or behavior of any existing service card. It must not start, stop, restart, reconfigure, or repair the router.

## Scope

The monitor targets the following fixed device:

- Display name: `iStoreOS 软路由`
- Management URL: `http://192.168.31.10/`
- SSH endpoint: `root@192.168.31.10:22`
- Identity file path: `/Users/cx/.ssh/id_ed25519`
- Subtitle: `iStoreOS 21.02.3 · PassWall2 / Xray`

The first version deliberately excludes process checks other than Xray, port inventory, resource monitoring, GitHub probing, PassWall2 enablement checks, log collection, automatic recovery, and configuration management. These can be added later only if there is a concrete need.

## User experience

The card appears in the existing first `网络基建` grid alongside the current infrastructure services. It uses the existing `280px` card height and grid row height. Existing cards are not resized or structurally changed.

The specialized card contains:

- the title and subtitle above;
- an overall state pill;
- the existing 24-hour status bar presentation;
- three current checks: `SSH`, `Xray`, and `代理链路`;
- Google probe elapsed time when the proxy-path probe succeeds;
- the time of the last completed probe;
- an `立即探测` action;
- an `打开管理界面` link that opens `http://192.168.31.10/` in a new browser tab.

It does not render start, stop, restart, or log actions. While the first probe is in flight, the card shows a neutral checking state rather than claiming that the router is offline.

## Status semantics

Each completed probe produces one of three overall states:

| State | Meaning | Services overview accounting |
|---|---|---|
| `healthy` | SSH succeeded, Xray was found, and Google returned HTTP 204 | Online/running |
| `proxy_error` | SSH succeeded, but Xray was missing or Google did not return HTTP 204 | Error |
| `offline` | The SSH connection or remote command could not be established | Stopped/offline |

The three current checks expose the cause without returning raw command output:

- `SSH` is successful when the fixed remote probe command starts and returns a parseable result.
- `Xray` is successful when `pgrep -f '/tmp/etc/passwall2/bin/xray run'` finds a process.
- `代理链路` is successful only when a request originating on the router is explicitly sent through the local Xray SOCKS listener at `127.0.0.1:1070` and `https://www.google.com/generate_204` returns HTTP 204. The probe uses remote DNS through SOCKS (curl's `socks5h` behavior), so a successful result covers the SOCKS listener, proxy-side name resolution, Xray outbound path, TLS, and HTTP. It must not silently fall back to the router's default direct route.

A single failed scheduled probe changes the displayed state immediately. A later scheduled or manual successful probe restores the healthy state immediately. There is no consecutive-failure state machine in this version.

## Probe scheduling and concurrency

The server runs an initial probe on startup, followed by one scheduled probe every five minutes. Clicking `立即探测` requests an immediate probe without changing the schedule.

Only one router probe may run at a time. If a scheduled or manual request arrives while a probe is already running, it awaits and returns the in-flight result instead of starting another SSH session.

The SSH connection uses a five-second connection timeout. The remote Google request uses an eight-second connection timeout and a fifteen-second total timeout. The server places a bounded timeout around the complete SSH operation so a hung child process cannot accumulate or block later monitoring indefinitely.

## Backend architecture

A focused `iStoreOSMonitor` module owns scheduling-independent probe behavior, in-flight coalescing, the latest normalized result, and status mapping. Its SSH execution dependency is injected so automated tests never contact the router.

The production executor invokes the local SSH client with an argument array rather than a locally interpolated shell command. The fixed arguments include:

- `-i /Users/cx/.ssh/id_ed25519`
- `-p 22`
- `-o IdentitiesOnly=yes`
- `-o BatchMode=yes`
- `-o ConnectTimeout=5`
- `root@192.168.31.10`

Default SSH host-key verification remains enabled. Before production monitoring is enabled, the Control Center backend user must already have a trusted entry for `192.168.31.10` in its `known_hosts`; the monitor never auto-accepts or replaces a host key.

The fixed remote command performs only the Xray process check and a Google request forced through `socks5h://127.0.0.1:1070`, then emits a small machine-readable allowlist of values. No request field, browser input, service action, or environment-derived free-form string is interpolated into that remote command. Failure to connect to the SOCKS listener is a failed proxy-path check, never a reason to retry the request directly.

The monitor is exposed as a specialized infrastructure service record with a discriminator such as `kind: "istoreos"`. The existing service response shape remains unchanged for ordinary services. The specialized record adds only normalized booleans, safe status codes, elapsed time, and probe timestamps needed by the card.

The existing service history storage is reused under a stable router service ID. Each completed scheduled or manual probe persists `running`, `error`, or `stopped` so the current 24-hour bucket aggregation and status bar can be reused. The neutral initial checking state is not persisted.

The service action route recognizes the router service ID and permits only `probe`. Requests for `start`, `stop`, or `restart` return a client error and do not execute a command. The global `探测全部服务` action includes the router probe, relying on in-flight coalescing if another router probe is already running.

## Frontend architecture

The service response type becomes a discriminated union between ordinary services and the specialized iStoreOS monitor record. `ServicesPage` continues grouping both by `group`, so the router naturally appears under `infra` and is included in overview counts.

The infrastructure section chooses the existing card for ordinary services and a focused `IStoreOSCard` for `kind: "istoreos"`. The specialized component shares the existing card height constants and visual tokens but does not change the ordinary card component. It maps `healthy`, `proxy_error`, `offline`, and initial checking states to clear labels and colors.

Manual probe completion is followed by the normal service-data refresh. The management link uses `target="_blank"` with `rel="noreferrer"`.

## Security and privacy

- Never read, copy, display, log, or commit the SSH private key contents.
- Never read `/etc/config/passwall2` or `/tmp/etc/passwall2/acl/default/global.json`.
- Do not read or return PassWall2 or Xray logs in this version.
- Do not return the remote command, raw stdout, or raw stderr to the browser.
- Do not write raw stdout or stderr to production logs.
- Do not disable host-key verification or automatically accept a changed host key.
- Do not expose start, stop, restart, shell, or configuration endpoints for this monitor.

Backend lifecycle and error logs use the existing structured Fastify logger, which includes timestamps. Router-monitor records contain a stable event code, the normalized outcome, durations or safe booleans when useful, and an ISO 8601 UTC probe timestamp. They do not contain credentials, raw command output, or secret-bearing configuration values.

## Error handling

SSH spawn failures, connection failures, authentication failures, host-key failures, timeouts, non-zero remote execution, and unparseable allowlisted output all produce the safe `offline` result. Raw SSH diagnostics remain server-side and are discarded rather than relayed or logged.

Once SSH is established and the result is parseable, a missing Xray process, SOCKS connection failure, or non-204 Google response produces `proxy_error`. Google timeout, proxy-side DNS failure, TLS failure, and other curl failures are represented by a safe failed proxy check without exposing curl stderr. The monitor never repeats the Google request without the SOCKS proxy.

Router failures remain isolated from ordinary service checks. A failed router probe must not prevent the Services page, other service cards, events, or actions from working.

## Testing and verification

Automated server tests use an injected fake SSH executor and cover:

- exact required SSH safety arguments;
- healthy, proxy-error, and offline status mapping;
- missing Xray, non-204 Google response, curl failure, SSH failure, timeout, and malformed output;
- in-flight probe coalescing;
- five-minute scheduling without overlapping work;
- persistence mapping to `running`, `error`, and `stopped`;
- `probe` being allowed while start, stop, and restart are rejected;
- browser responses and structured log fields excluding private-key content and raw SSH output.

Client tests cover specialized-card selection, overview accounting, status labels, the unchanged `280px` height contract, and the absence of management actions other than probe and the management-page link.

Verification includes server tests, client tests, both TypeScript builds, the client production build, and one manual real-device read-only probe. The manual check must not execute any mutation or print the identity file.

## Acceptance criteria

- A same-height iStoreOS card appears in the Services page `网络基建` section without changing existing card heights.
- Within five minutes of startup, or sooner after the initial probe, the card shows whether the router is reachable and whether Xray plus a Google request forced through its local SOCKS listener work.
- The card shows a 24-hour status history and safe current check results.
- `立即探测` works without creating overlapping SSH processes.
- `打开管理界面` opens the router UI in a new tab.
- No start, stop, restart, log, configuration, or repair capability is available for the router.
- No private-key content, node credentials, sensitive PassWall2 configuration, or raw SSH output is committed, logged, or returned to the browser.
- Existing service cards and unrelated dashboard behavior remain unchanged.
