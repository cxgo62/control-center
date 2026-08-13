# Clash Verge and KiwiVM Network Overview Design

## Goal

Update the network overview sidebar so it reads the active Clash Verge Rev configuration instead of the retired FlClash configuration, and add a secure BandwagonHost/KiwiVM traffic summary showing the VPS identity, transfer consumption, remaining allowance, reset time, and account warnings.

## Scope

This change is limited to the existing Control Center network sidebar and its server APIs. It does not modify Clash Verge, the VPS, Xray/VLESS, proxy routing, or any KiwiVM resource. The KiwiVM integration uses only the read-oriented `getServiceInfo` endpoint.

## Clash Verge status

- Replace the private client/server `FlClash` naming with `Clash Verge` naming.
- The server reads:
  `~/Library/Application Support/io.github.clash-verge-rev.clash-verge-rev/config.yaml`.
- Parse and return only these operational fields:
  - `mixedPort`
  - `mode`
  - `tunEnabled`
  - `tunStack`
- Map `mixed-port` to `mixedPort`, `mode` to `mode`, `tun.enable` to `tunEnabled`, and `tun.stack` to `tunStack`. A missing or invalid required field produces the unavailable response rather than a partially fabricated status.
- Expose the data through `GET /api/network/clash`.
- The sidebar card is labelled `Clash Verge` and retains the current four-cell presentation for TUN mode, protocol stack, proxy port, and routing mode.
- Remove the hard-coded FlClash version because it is stale and the current YAML file does not provide a reliable application version.
- A successful response is:

  ```ts
  {
    available: true;
    mixedPort: number;
    mode: string;
    tunEnabled: boolean;
    tunStack: string;
  }
  ```

- If the file cannot be read or parsed, return HTTP 200 with `{ available: false, error: { code: 'CLASH_CONFIG_UNAVAILABLE', message: 'Clash Verge 配置不可用' } }`. An unavailable status card is optional to render; it must never break the rest of the sidebar.
- Do not read or return proxies, controller secrets, subscription URLs, or the full configuration.

## KiwiVM credentials

- The credential file is `.private/kiwivm.env` at the repository root.
- The file contains:

  ```dotenv
  KIWIVM_VEID=replace_me
  KIWIVM_API_KEY=replace_me
  ```

- Add `.private/` to the repository `.gitignore`.
- Commit a placeholder template outside the ignored directory as `.private.example/kiwivm.env.example`, so the template remains trackable while the entire real private directory stays ignored.
- The user will add the real values later and set the real credential file mode to `600`.
- The server must not log, return, interpolate into URLs, or include either credential in thrown error messages.

## KiwiVM request and cache

- Add `GET /api/network/kiwivm-traffic` to the existing network routes.
- The route loads credentials on the server and sends an HTTPS `POST` request to `https://api.64clouds.com/v1/getServiceInfo`.
- Submit `veid` and `api_key` as `application/x-www-form-urlencoded` request-body fields, never as URL query parameters.
- Use a finite request timeout of 20 seconds.
- Validate the HTTP status, JSON syntax, KiwiVM `error` field, and every consumed value.
- Cache a successful normalized result in memory for five minutes. Do not persist the response. Failed requests are not retained in the success cache.
- The cache TTL begins when a successful upstream response finishes normalization. A hit on a completed cache entry returns `cached: true`; the fresh request that populated it returns `cached: false`.
- Concurrent requests during a cold cache or immediately after expiry share one in-flight promise, so only one upstream request is made. All callers awaiting that fresh request receive `cached: false`.
- The route never exposes the raw KiwiVM response.
- Important fetch failures are logged with the existing Fastify structured logger. Log records contain Fastify/Pino timestamps and a sanitized error code/message, never credentials or the raw response.

## Traffic calculation

The calculation is implemented once in a pure server module:

```text
used_bytes      = data_counter * monthly_data_multiplier
total_bytes     = plan_monthly_data
remaining_bytes = max(total_bytes - used_bytes, 0)
usage_percent   = used_bytes / total_bytes * 100
```

- `plan_monthly_data` must be greater than zero.
- `data_counter` and `monthly_data_multiplier` must be finite, non-negative numbers; the multiplier must be greater than zero.
- All displayed transfer values use IEC units (`GiB` or `TiB`) and clearly show the unit.
- The API payload includes `monthlyDataMultiplier` and a calculation-method identifier so a multiplier greater than one can be visibly marked for later calibration against the KiwiVM panel.
- This initial implementation uses candidate A from the handoff document. It must not describe the result as independently verified billing data until the user supplies credentials and compares it to KiwiVM.

## Raw KiwiVM field mapping

The server consumes and validates only these raw `getServiceInfo` fields:

| Raw field | Accepted value | Normalized use |
| --- | --- | --- |
| `error` | finite number; `0` means success | API success/failure gate |
| `message` | optional string | never relayed verbatim; used only to identify that an API error occurred |
| `hostname` | non-empty string | `hostname` |
| `node_location` | non-empty string | `location` |
| `plan_monthly_data` | finite number greater than zero | `totalBytes` |
| `data_counter` | finite non-negative number | candidate-A used-byte calculation |
| `monthly_data_multiplier` | finite number greater than zero | candidate-A used-byte calculation and calibration note |
| `data_next_reset` | finite Unix timestamp in seconds greater than zero | multiplied by 1,000 to produce `nextResetAt` in Unix milliseconds |
| `suspended` | boolean or numeric `0`/`1` | normalized boolean |
| `policy_violation` | boolean or numeric `0`/`1` | normalized boolean |

Numeric strings are rejected rather than coerced. Unknown fields are ignored. The server never forwards a sanitized or unsanitized raw fixture to the client. A representative test fixture may contain only these fields and must use dummy values.

## Normalized KiwiVM response

When configured and successful, the browser receives only this allowlisted information:

```ts
{
  configured: true;
  hostname: string;
  location: string;
  usedBytes: number;
  totalBytes: number;
  remainingBytes: number;
  usagePercent: number;
  monthlyDataMultiplier: number;
  calculationMethod: 'used-times-multiplier';
  nextResetAt: number;
  suspended: boolean;
  policyViolation: boolean;
  severity: 'normal' | 'notice' | 'warning' | 'critical';
  fetchedAt: number; // Unix milliseconds
  cached: boolean;
}
```

`nextResetAt` is also Unix milliseconds. Both timestamps are therefore directly consumable by JavaScript `Date`.

`severity` is calculated from usage percentage: below 70% is normal, 70%–84.99% is notice, 85%–94.99% is warning, and 95% or higher is critical. Suspension and policy violations are separate prominent warnings and are not hidden by the traffic severity.

When the credential file is absent, unreadable, incomplete, or still contains placeholder values, the route returns HTTP 200 with:

```ts
{ configured: false, reason: 'credentials_missing' }
```

Other failures use this response shape:

```ts
{
  configured: true;
  error: {
    code:
      | 'KIWIVM_TIMEOUT'
      | 'KIWIVM_NETWORK_ERROR'
      | 'KIWIVM_UPSTREAM_HTTP'
      | 'KIWIVM_INVALID_JSON'
      | 'KIWIVM_API_ERROR'
      | 'KIWIVM_INVALID_DATA';
    message: string;
  };
}
```

`KIWIVM_TIMEOUT` returns HTTP 504. DNS failures, refused/reset connections, and other non-timeout fetch rejections map to `KIWIVM_NETWORK_ERROR` with HTTP 502. The remaining four codes also return HTTP 502. Messages are locally defined generic Chinese messages; KiwiVM's raw `message` value is never relayed or logged. The client treats any non-2xx payload matching this contract as a card-local error state.

## Sidebar presentation

- Add a BandwagonHost/KiwiVM card immediately below the Clash Verge card.
- The card displays all useful allowlisted service information supplied by `getServiceInfo`:
  - hostname and location;
  - used, total, and remaining transfer;
  - usage percentage with a compact progress indicator;
  - next reset time formatted in `Asia/Shanghai` and labelled with that time zone;
  - usage severity;
  - suspended and policy-violation warnings when applicable;
  - a multiplier/calibration note when the multiplier is not `1`.
- If credentials are not configured, keep the card visible with a concise `待配置凭据` state and the expected relative file path.
- If the request fails, keep the rest of the network sidebar functional and display a compact safe error state inside only the KiwiVM card.
- Fetch on sidebar mount and refresh every five minutes. The server cache prevents multiple open clients from multiplying upstream API traffic.

## Component boundaries

- A focused server module owns credential parsing, KiwiVM response validation, traffic calculation, sanitization, caching, and the upstream fetch interface.
- The existing network route module registers HTTP routes and performs Fastify logging, but does not contain calculation rules.
- A focused client formatter module owns byte, percentage, and Shanghai reset-time formatting so presentation behavior is unit-testable without rendering React.
- `NetworkPage.tsx` owns fetch state and renders the two sidebar cards using the normalized data only.

## Error handling and security

- Never include `KIWIVM_API_KEY`, `KIWIVM_VEID`, the full request body, or raw response in logs or browser responses.
- Reject missing, string-valued, non-finite, negative, or otherwise invalid numeric response fields.
- Clamp remaining transfer at zero and avoid division by zero.
- Distinguish configuration absence from upstream/network/data failures.
- A failed Clash or KiwiVM card must not prevent network probe data from loading.
- No endpoint performs start, stop, reinstall, restart, migration, or any other VPS mutation.

## Testing and verification

Server tests use injected fake HTTP behavior and placeholder credentials; they never contact the real KiwiVM API. Cover:

- Clash Verge YAML parsing for port, mode, TUN enabled state, and stack.
- Correct transfer calculation for multiplier `1` and greater than `1`.
- Remaining transfer clamped to zero.
- Severity thresholds.
- Missing, string, negative, zero-total, and malformed fields.
- KiwiVM `error != 0`, invalid JSON, HTTP errors, timeout/network errors, and cache behavior.
- Suspension and policy-violation flags.
- Credential/key redaction from returned and thrown errors.
- Reset-time and transfer formatting on the client.

Verification consists of server tests, client tests, server TypeScript build, client production build, and a manual sidebar check with credentials absent. A real KiwiVM integration and billing-calculation calibration remain a documented follow-up until the user places valid credentials in `.private/kiwivm.env`.

## Acceptance criteria

- The sidebar labels and reads Clash Verge rather than FlClash and reflects the current port, routing mode, TUN state, and stack.
- A visible KiwiVM card handles unconfigured, loading, successful, warning, and safe error states.
- With valid credentials, it shows hostname, location, used/total/remaining transfer, usage percentage, reset time, and status warnings.
- `.private/` is ignored and no real secret appears in tracked files, logs, tests, or browser payloads.
- The implementation passes automated tests and production builds without contacting KiwiVM during tests.
- Existing proxy configuration and network-probe behavior remain unchanged.
