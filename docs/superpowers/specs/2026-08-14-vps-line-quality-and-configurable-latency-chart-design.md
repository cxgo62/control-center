# VPS Line Quality and Configurable Latency Chart Design

## Goal

Compress the oversized network summary area, add focused monitoring for the private BandwagonHost VPS route, and make the existing latency comparison chart configuration-driven. The page should answer two different questions without mixing them:

- How healthy is the overall set of domestic and international website probes?
- How healthy is the route from this Mac to the private BandwagonHost VPS itself?

## Scope

This change is limited to the existing network page, its read-only monitoring APIs, and the background network monitor. It does not modify Clash Verge, change the active proxy, restart the VPS, run bandwidth tests, or expose node credentials.

The initial latency comparison chart contains four series: domestic average, international average, ChatGPT, and Google. The chart implementation must support adding later series through configuration without React changes.

## Page layout

Use the approved “top status bar” layout:

- Remove the large top-right `SummaryCard`.
- Add a compact status bar across the top of the content grid. It contains overall availability, online target count, domestic average latency, international average latency, and the existing `1h / 6h / 24h / 7d` range selector.
- Keep the domestic and international connectivity cards in the left content column.
- Use the full top-right grid cell for a new `搬瓦工私人线路` card.
- Keep the latency comparison chart in the bottom-right grid cell.
- Keep the current left sidebar, including Clash Verge state, KiwiVM traffic, current link state, manual override, and probe action.
- At narrow widths the compact status metrics may wrap, but the desktop content grid remains the primary layout.

## Private node identity and discovery

The monitored target is the private BandwagonHost node, not whichever public proxy is currently selected in Clash Verge.

- Identify the node by a stable configured Clash node name. Add a server-side monitor configuration with the node name; do not send this configuration object to the browser.
- Supply the name through the `VPS_LINE_NODE_NAME` environment variable, normalized by trimming whitespace in `server/src/config.ts`. The name is an identifier, not a resolved address.
- If `VPS_LINE_NODE_NAME` is absent or blank, keep the server and the rest of the network page running, do not start discovery or probing, log one sanitized startup warning, and return the card-local `私人节点未配置` state. An invalid or unmatched non-empty name returns `无法识别私人节点` and continues the normal low-frequency rediscovery schedule.
- Read the generated Clash Verge configuration at the existing `clash-verge.yaml` path and locate the matching proxy entry.
- Extract only the node address and port needed for ICMP and TCP probing. Do not retain or return passwords, UUIDs, transport settings, subscription URLs, controller secrets, or unrelated proxy definitions.
- Keep the resolved address and port in memory. The browser receives only a fixed display label, never the address or port.
- Discovery runs at server startup, after a debounced file-change event for `clash-verge.yaml`, and every 30 minutes as a fallback.
- The one-minute probe loop reads the cached endpoint and does not reparse Clash configuration.
- Three consecutive failed probe rounds trigger one early rediscovery, with a cooldown so persistent failures cannot turn into continuous parsing.
- If rediscovery determines that the configured node no longer exists, invalidate the cached endpoint instead of probing an old address indefinitely.

Node discovery and line probing are independent units with separate states and logs.

## VPS line probing

Run one probe round every 60 seconds:

1. Send 10 ICMP echo requests to the cached VPS host.
2. Attempt one TCP connection to the cached VPS proxy port with a finite timeout.
3. Store one aggregate sample rather than every raw echo response.

Each stored sample contains:

- probe timestamp;
- configured node identity, without its address;
- echo requests sent and received;
- median successful round-trip time;
- P95 successful round-trip time;
- jitter, defined as the mean absolute difference between consecutive successful RTT values;
- TCP connectivity state;
- whether ICMP produced usable data.

Use a spawned process with fixed arguments for the platform ping command, never a shell-interpolated command. Apply finite process and TCP timeouts and terminate overdue probes. Ping output parsing and TCP behavior must be injectable in tests; automated tests must not contact the real VPS.

Do not add active download or bandwidth testing. It would consume metered VPS transfer and could interfere with normal proxy use.

## Storage and aggregation

Add a focused SQLite table for aggregate VPS probe samples. Store no secrets and no resolved IP address. Existing database startup initialization owns the schema change.

`GET /api/network/vps-line?range=1h|6h|24h|7d` returns:

- discovery state and a safe display label;
- the latest probe state;
- a quality classification calculated from the latest five-minute rolling window;
- current median latency, P95, packet-loss rate, jitter, TCP state, and probe time;
- 48 chronological buckets for the selected range.

Each bucket contains its start and end timestamps, `hasData`, aggregate median latency, aggregate P95 latency, total sent and lost counts, packet-loss percentage, aggregate jitter, and TCP state. Bucket TCP state is `up` when every recorded attempt succeeded, `intermittent` when successes and failures are mixed, `down` when every recorded attempt failed, and `unknown` when no attempt exists. Missing buckets remain explicit missing data and are not represented as zero latency or zero loss.

Bucket numeric reductions are deterministic: sum sent/received counts and derive loss from those totals; calculate bucket median latency as the received-count-weighted mean of the available per-round median RTT values; calculate bucket P95 as the maximum available per-round P95 value so short tail-latency spikes remain visible; and calculate bucket jitter as the successful-adjacent-pair-weighted mean of per-round jitter, where a round contributes `max(received - 1, 0)` pairs. A metric with no contributing value is `null`, not zero.

The API uses safe local error codes/messages. It does not return the raw Clash entry, node address, port, parser error text, command output, or secrets.

## Quality classification

Calculate the card label from probe rounds in the latest five-minute rolling window. Sum sent and received counts to calculate window loss, take the median of the stored per-round median RTT values for window latency, and take the arithmetic mean of available per-round jitter values for window jitter. The latest probe round supplies the current TCP state shown in the card and used by the quality label; mixed older TCP results remain visible in chart buckets but do not override a recovered latest connection.

Require at least three completed probe rounds before assigning `good` or `degraded`; until then show `正在积累线路样本`. A failed latest TCP attempt may immediately assign `poor` without waiting for three rounds. After three rounds, zero successful echo responses with a successful latest TCP connection produces the special `Ping 不可用 · 代理端口正常` state rather than treating missing ICMP permission as ordinary packet loss. Otherwise, the worst matching threshold wins:

- `good` / `质量良好`: TCP connects, loss is below 1%, jitter is below 20 ms, and median latency is below 250 ms.
- `degraded` / `有波动`: loss is at least 1% but below 5%, jitter is at least 20 ms but below 50 ms, or median latency is at least 250 ms but below 400 ms.
- `poor` / `质量较差`: the latest TCP attempt does not connect, loss is at least 5%, jitter is at least 50 ms, or median latency is at least 400 ms.
- `unavailable` / `数据不可用`: the node cannot be resolved, too little data exists, or ICMP is unavailable.

Boundary values enter the more severe band: 1%, 5%, 20 ms, 50 ms, 250 ms, and 400 ms are classified consistently in pure unit-tested functions.

Special states must preserve diagnostic meaning:

- ICMP unavailable with successful TCP: `Ping 不可用 · 代理端口正常`; do not call the host offline.
- ICMP available with failed TCP: `主机在线 · 代理端口异常`.
- Node discovery failure: `无法识别私人节点`.
- Initial collection: `正在积累线路样本`.

## VPS card and synchronized hover

The card header shows the fixed private-line label and quality state. Its four primary metrics are current median latency, selected-range packet-loss rate, jitter, and current TCP connectivity.

The chart has two vertically aligned layers sharing the same 48 buckets:

- a purple median-latency line; and
- a narrow packet-loss band: green below 1%, yellow from 1% up to but not including 5%, red at 5% or higher, and gray for missing data.

P95 and jitter remain available in the tooltip rather than becoming extra lines.

Hovering either layer produces one vertical crosshair through both layers and one tooltip for the same bucket. The tooltip contains the bucket time interval, median latency, P95 latency, loss percentage, lost/sent counts, jitter, and TCP state. A missing bucket says `该时段无探测数据`. Tooltip positioning must stay inside the card at both horizontal edges.

## Configurable latency comparison chart

Replace the hard-coded domestic/international arrays with a server-side series configuration. Each configured series has:

```ts
{
  id: string;
  label: string;
  source:
    | { kind: 'group'; group: 'domestic' | 'international'; path: 'direct' | 'proxy' }
    | { kind: 'target'; targetId: string; path: 'direct' | 'proxy' };
  color: string;
  order: number;
}
```

The initial configuration is:

- domestic average from the domestic/direct group, green;
- international average from the international/proxy group, purple;
- ChatGPT from the `chatgpt` target over the proxy path, blue;
- Google from the `google` target over the proxy path, amber.

The network data API returns `latencySeries[]` in configured order. Each item contains `id`, `label`, `color`, and 48 timestamped latency buckets. The client generically renders all returned series, legends, and tooltip rows; it contains no ChatGPT- or Google-specific branches.

Hover shows one crosshair and one combined tooltip with the bucket time and the latency for every configured series. Missing series data is displayed as `无数据`, not `0ms`, and the line has a visual gap. The server validates unique IDs, known targets/groups, supported paths, and usable colors. Invalid series are skipped with a sanitized structured warning rather than breaking the page.

## Component boundaries

Keep the implementation focused:

- A private-node resolver owns Clash parsing, safe allowlisting, caching, file watching, fallback refresh, and rediscovery cooldown.
- A VPS line prober owns ICMP/TCP execution and sample calculation.
- Pure aggregation and quality functions own the 48-bucket response and five-minute state.
- Network routes expose normalized read-only data and log sanitized failures.
- A compact status-bar component replaces `SummaryCard`.
- A VPS line-quality card owns metric and empty/error-state presentation.
- Reusable chart/tooltip helpers own synchronized bucket lookup and edge-safe positioning.
- The latency comparison chart renders the generic `latencySeries[]` contract.

Avoid unrelated refactoring and do not introduce a general charting dependency unless the existing SVG approach proves unable to meet these requirements.

## Logging and security

- Use the existing structured backend logger. Important discovery lifecycle, probe failure, and recovery paths must be logged.
- Every record uses the logger's ISO 8601 UTC timestamp.
- Never use bare `console.log` or `print` in production backend code.
- Never log or return Clash secrets, subscriptions, full proxy entries, raw configuration, raw ping output, or resolved node addresses.
- Logs use stable codes and sanitized context such as configured node identity, failure category, and consecutive-failure count.
- All endpoints are read-only and cannot change Clash or VPS state.

## Testing and verification

Keep verification proportional and focused:

- Resolver tests: matching node, address/port change, missing node, malformed configuration, safe field allowlisting, invalidation, and rediscovery cooldown.
- Probe calculation tests: full success, partial/all loss, median, P95, jitter, TCP failure, ICMP unavailable, timeout, and no shell interpolation.
- Aggregation tests: all ranges, 48 buckets, lost/sent rollup, missing data, five-minute classifications, and exact threshold boundaries.
- API tests: normalized responses, safe failures, and absence of address, port, credentials, and raw output.
- Client pure-function tests: synchronized bucket selection, four-series tooltip contents, missing series, and edge-safe tooltip position.
- Configuration tests: initial four-series order and invalid/duplicate series handling.
- Run server tests and TypeScript build, client tests and production build, then manually inspect the network page at desktop size and a narrower viewport.

## Acceptance criteria

- The large summary card is replaced by a compact cross-column status bar.
- The complete top-right cell shows the private BandwagonHost VPS route card.
- Clash parsing is separate from the one-minute probe loop and normally occurs only at startup, file changes, or the 30-minute fallback.
- VPS IP or port changes in Clash Verge are picked up without editing Control Center configuration.
- The VPS card reports median latency, P95 in hover, packet loss, jitter, TCP connectivity, quality, and meaningful degraded states.
- VPS latency and packet loss hover in lockstep on the same time bucket.
- The latency comparison chart initially shows domestic average, international average, ChatGPT, and Google with matching legends and a combined hover tooltip.
- Adding another website curve requires configuration only, not React changes.
- Missing data is never rendered as a successful zero value.
- Structured backend logs include timestamps and reveal no sensitive configuration.
- Existing network cards, range selection, manual probing, Clash status, and KiwiVM traffic continue to work.
