# Phenology Backup and Tunnel Monitoring Design

## Goal

Add two launchd-managed services to Control Center and include them in the existing service polling, availability history, manual probe, restart, and log-viewing workflows.

## Service cards

### Phenology Backup / Codex Worker

- ID: `phenology-backup`
- Group: `app` (个人应用)
- Display name: `Phenology Backup / Codex Worker`
- Technology subtitle: `备份节点 · 本地 Codex Worker`
- Address and port: `127.0.0.1:5178`, `:5178`
- Open URL: `http://127.0.0.1:5178`
- launchd label: `top.damkeeper.phenology-backup`
- Health URL: `http://127.0.0.1:5178/api/system/runtime-status`
- Health timeout: 5 seconds
- Expected response:
  - HTTP status is `200`
  - `runtimeRole` is `backup`
  - `readOnly` is `true`
  - `codex.provider` is `local`
  - `codex.status` is `available`
- Logs:
  - 标准输出: `/Users/cx/cx/phenology-backup/.prod/logs/launchd.out.log`
  - 标准错误: `/Users/cx/cx/phenology-backup/.prod/logs/launchd.err.log`

### Phenology Primary Tunnel

- ID: `phenology-primary-tunnel`
- Group: `infra` (网络基建)
- Display name: `Phenology Primary Tunnel`
- Technology subtitle: `双向 SSH 隧道 · 主备互联`
- Address and port: `127.0.0.1:15177`, `:15177 / :15178`
- No Open URL is shown because the forwarded endpoint is a health/API endpoint rather than a user-facing page.
- launchd label: `top.damkeeper.phenology-primary-tunnel`
- Health URL: `http://127.0.0.1:15177/api/system/runtime-status`
- Health timeout: 5 seconds
- Expected response:
  - HTTP status is `200`
  - `runtimeRole` is `primary`
  - `readOnly` is `false`
  - `codex.provider` is `rpc`
  - `codex.status` is `available`
- Logs:
  - 标准输出: `/Users/cx/cx/phenology-backup/.prod/logs/tunnel.out.log`
  - 标准错误: `/Users/cx/cx/phenology-backup/.prod/logs/tunnel.err.log`

## Health-check model

Extend `ServiceConfig` with an optional structured health assertion. It contains an HTTP status expectation, a recursively nested partial JSON expectation, and an optional timeout. Expected leaf values are compared with strict equality; object keys not listed in the expectation are ignored. A missing expected key, invalid JSON body, wrong HTTP status, wrong value, timeout, or connection error fails the health assertion.

The configuration shape is explicit and nested rather than dot-path based. For example, the backup service declares:

```typescript
health: {
  timeoutMs: 5_000,
  expect: {
    httpStatus: 200,
    json: {
      runtimeRole: 'backup',
      readOnly: true,
      codex: { provider: 'local', status: 'available' },
    },
  },
}
```

The feature is opt-in. Existing service configurations without a structured assertion retain their current monitoring semantics.

For a launchd-managed service with a structured health assertion, status is derived as follows:

1. If the launchd job is absent or not running, report `stopped`.
2. If the launchd job is running and all health assertions pass, report `running` and record request latency.
3. If the launchd job is running but the health request or any assertion fails, report `error` and record the completed probe. Persist the request's measured elapsed milliseconds when available, including for timeout, connection, HTTP-status, JSON-parse, and assertion failures; use zero/null only when no request timing exists.

Both new services automatically participate in the existing 30-second polling loop, persisted checks, 24-hour status bars, overview counts, and “探测全部服务” operation because they are entries in `SERVICES`.

## launchd management

For launchd services, restart uses `launchctl kickstart -k gui/<current uid>/<label>`. Start and stop retain the existing bootstrap and bootout behavior so a stopped job can still be loaded from its plist. On the current host, the resolved restart targets are:

- `gui/501/top.damkeeper.phenology-backup`
- `gui/501/top.damkeeper.phenology-primary-tunnel`

## Error handling and logging

Health failures are represented by the existing `error` service status and persisted in the service-check history. Routine failures do not throw out of the whole polling batch. Existing Fastify structured logging remains the production logging mechanism; scheduler lifecycle and batch failures continue to be timestamped by Fastify's logger.

Manual restart errors continue to be returned by the service action API. Log cards use the existing log drawer and file-tail endpoint.

## Testing

Add focused server tests before implementation for:

- successful recursive partial JSON matching;
- wrong HTTP status;
- missing or mismatched nested fields;
- invalid JSON when JSON is expected;
- HTTP timeout or connection failure;
- a running launchd job whose health assertion fails becoming `error`;
- the launchd restart command using `kickstart -k`;
- both new service configurations, their groups, endpoints, expectations, management labels, and log files.

Run server tests, TypeScript builds for server and client, client tests, and the production client build. Preserve unrelated uncommitted work already present in the repository.
