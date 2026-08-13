# Clash Verge and KiwiVM Network Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the network sidebar read Clash Verge Rev and securely show the BandwagonHost/KiwiVM VPS traffic allowance and warnings.

**Architecture:** Extract pure server modules for Clash YAML parsing and KiwiVM credential/response normalization, then keep Fastify routes responsible only for filesystem/upstream orchestration and structured logging. Add a typed browser API and pure display formatters, while `NetworkPage.tsx` owns card-local loading, unconfigured, success, and error states.

**Tech Stack:** TypeScript, Node.js 22, Fastify 4, Undici-compatible `fetch`, React 18, Vite, Node test runner.

---

## File structure

- Create `server/src/routes/clash-status.ts`: parse a safe allowlist from Clash Verge YAML text.
- Create `server/test/clash-status.test.ts`: verify correct parsing and rejection of invalid required fields.
- Create `server/src/routes/kiwivm-traffic.ts`: load credentials, validate/normalize KiwiVM data, calculate usage/severity, perform the POST, and deduplicate/cache successful requests.
- Create `server/test/kiwivm-traffic.test.ts`: cover calculation, validation, sanitization, transport handling, timeout mapping, and cache behavior with fake fetchers.
- Modify `server/src/routes/network.ts`: register the renamed Clash route and the KiwiVM route; emit structured sanitized errors.
- Modify `client/src/api.ts`: expose `getClashStatus` and `getKiwiVmTraffic` with response unions.
- Create `client/src/components/kiwivm-format.ts`: format IEC traffic, percentages, and Shanghai reset timestamps.
- Create `client/test/kiwivm-format.test.ts`: test deterministic client formatting.
- Modify `client/src/components/NetworkPage.tsx`: rename the Clash card and add the KiwiVM states/card.
- Modify `.gitignore`: exclude `.private/`.
- Create `.private.example/kiwivm.env.example`: track only placeholders.
- Create `docs/operations/kiwivm-traffic-monitoring.md`: document setup, permission `600`, calculation assumption, and calibration follow-up.

### Task 1: Parse and expose Clash Verge status

**Files:**
- Create: `server/src/routes/clash-status.ts`
- Create: `server/test/clash-status.test.ts`
- Modify: `server/src/routes/network.ts`

- [ ] **Step 1: Write failing parser tests**

Create tests that import `parseClashVergeConfig` and assert:

```ts
assert.deepEqual(parseClashVergeConfig(`
mixed-port: 7897
mode: rule
tun:
  stack: gvisor
  enable: true
`), {
  available: true,
  mixedPort: 7897,
  mode: 'rule',
  tunEnabled: true,
  tunStack: 'gvisor',
});
```

Also assert missing `mixed-port`, an out-of-range port, missing/empty `mode`, and missing TUN fields return the exact safe unavailable shape with no source content.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `cd server && node --import tsx --test --test-name-pattern="Clash Verge" test/*.test.ts`

Expected: FAIL because `clash-status.ts` does not exist.

- [ ] **Step 3: Implement the minimal safe parser**

Export:

```ts
export type ClashStatus =
  | { available: true; mixedPort: number; mode: string; tunEnabled: boolean; tunStack: string }
  | { available: false; error: { code: 'CLASH_CONFIG_UNAVAILABLE'; message: string } };

export function parseClashVergeConfig(content: string): ClashStatus;
export const unavailableClashStatus: ClashStatus;
```

Parse only `mixed-port`, `mode`, `tun.enable`, and `tun.stack`. Require an integer port from 1 through 65535 and non-empty mode/stack strings. Do not parse or return any other YAML keys.

- [ ] **Step 4: Verify GREEN**

Run: `cd server && node --import tsx --test --test-name-pattern="Clash Verge" test/*.test.ts`

Expected: all focused tests PASS.

- [ ] **Step 5: Replace the legacy route**

In `server/src/routes/network.ts`:

- replace `GET /api/flclash` with `GET /api/network/clash`;
- read `~/Library/Application Support/io.github.clash-verge-rev.clash-verge-rev/clash-verge.yaml`, whose generated TUN block includes the explicit `enable` flag;
- pass text to `parseClashVergeConfig`;
- return `unavailableClashStatus` on filesystem errors;
- log a sanitized structured warning through `fastify.log.warn({ code: 'CLASH_CONFIG_UNAVAILABLE' }, 'Clash Verge config unavailable')` without the filesystem error object or source content;
- replace the existing `probeAll().catch(console.error)` with a structured `fastify.log.error({ code: 'NETWORK_PROBE_FAILED' }, 'Background network probe failed')` callback, removing the bare production `console.error` while this route file is being modified;
- remove `parseFlClashConfig` and all `com.follow.clash` references.

- [ ] **Step 6: Run server tests and build**

Run: `cd server && npm test && npm run build`

Expected: PASS and TypeScript exits 0.

- [ ] **Step 7: Commit Task 1**

```bash
git add server/src/routes/clash-status.ts server/test/clash-status.test.ts server/src/routes/network.ts
git commit -m "fix: read Clash Verge network status"
```

### Task 2: Normalize and fetch KiwiVM traffic safely

**Files:**
- Create: `server/src/routes/kiwivm-traffic.ts`
- Create: `server/test/kiwivm-traffic.test.ts`

- [ ] **Step 1: Write failing credential and normalization tests**

Cover these pure contracts:

```ts
assert.deepEqual(parseKiwiVmCredentials(
  'KIWIVM_VEID=123\nKIWIVM_API_KEY=dummy-secret\n'
), { veid: '123', apiKey: 'dummy-secret' });

assert.deepEqual(normalizeKiwiVmResponse({
  error: 0,
  hostname: 'example-host',
  node_location: 'US, California',
  plan_monthly_data: 500 * 1024 ** 3,
  data_counter: 100 * 1024 ** 3,
  monthly_data_multiplier: 2,
  data_next_reset: 1788364800,
  suspended: 0,
  policy_violation: false,
}, 1_000), {
  configured: true,
  hostname: 'example-host',
  location: 'US, California',
  usedBytes: 200 * 1024 ** 3,
  totalBytes: 500 * 1024 ** 3,
  remainingBytes: 300 * 1024 ** 3,
  usagePercent: 40,
  monthlyDataMultiplier: 2,
  calculationMethod: 'used-times-multiplier',
  nextResetAt: 1788364800 * 1000,
  suspended: false,
  policyViolation: false,
  severity: 'normal',
  fetchedAt: 1_000,
  cached: false,
});
```

Add separate tests for multiplier `1`, remaining clamped to zero, all four severity thresholds, boolean/numeric flags, numeric strings, negative values, zero total, zero reset time, missing fields, API `error != 0`, and thrown error text not containing a dummy API key or VEID.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `cd server && node --import tsx --test --test-name-pattern="KiwiVM" test/*.test.ts`

Expected: FAIL because `kiwivm-traffic.ts` does not exist.

- [ ] **Step 3: Implement credentials, validation, and normalization**

Define a `KiwiVmError` carrying only stable `code`, safe `message`, and HTTP `statusCode`. Implement:

```ts
export function parseKiwiVmCredentials(content: string): KiwiVmCredentials | null;
export function normalizeKiwiVmResponse(raw: unknown, fetchedAt: number): KiwiVmTrafficSuccess;
export function severityForUsage(percent: number): KiwiVmSeverity;
```

Reject placeholder values (`replace_me`), malformed lines, missing variables, and invalid raw values. Ignore unknown raw fields. Do not include raw values in error messages.

- [ ] **Step 4: Verify pure GREEN**

Run: `cd server && node --import tsx --test --test-name-pattern="KiwiVM" test/*.test.ts`

Expected: normalization and validation tests PASS; request/cache tests added next may still be absent.

- [ ] **Step 5: Write failing POST, error-map, and cache tests**

Inject a fake fetch function and assert:

- URL is exactly `https://api.64clouds.com/v1/getServiceInfo` without a query string;
- method is POST, content type is form encoded, and body contains the dummy credential fields;
- HTTP non-success maps to `KIWIVM_UPSTREAM_HTTP`;
- invalid JSON maps to `KIWIVM_INVALID_JSON`;
- timeout/abort maps to `KIWIVM_TIMEOUT` with 504;
- other fetch rejection maps to `KIWIVM_NETWORK_ERROR`;
- successful results are cached for five minutes and later hits set `cached: true`;
- two concurrent cold-cache calls invoke the fake fetch exactly once;
- failed calls are not cached;
- no error response contains the dummy key or VEID.

- [ ] **Step 6: Run request tests and verify RED**

Run: `cd server && node --import tsx --test --test-name-pattern="KiwiVM" test/*.test.ts`

Expected: FAIL because the request/cache client is not implemented.

- [ ] **Step 7: Implement POST, timeout, in-flight deduplication, and cache**

Export a factory so each test owns isolated cache state:

```ts
export function createKiwiVmTrafficClient(options?: {
  fetcher?: typeof fetch;
  now?: () => number;
  ttlMs?: number;
  timeoutMs?: number;
}): {
  get(credentials: KiwiVmCredentials): Promise<KiwiVmTrafficSuccess>;
};
```

Use `URLSearchParams` as the request body and an abort signal with the configured 20-second default. Store only successful normalized values. Clear the shared in-flight promise in `finally`. Return copies so cache hits can set `cached: true` without mutating the stored object.

- [ ] **Step 8: Verify request/cache GREEN and full server suite**

Run: `cd server && npm test && npm run build`

Expected: all tests PASS and TypeScript exits 0.

- [ ] **Step 9: Commit Task 2**

```bash
git add server/src/routes/kiwivm-traffic.ts server/test/kiwivm-traffic.test.ts
git commit -m "feat: add secure KiwiVM traffic client"
```

### Task 3: Register the KiwiVM API and local credential template

**Files:**
- Modify: `server/src/routes/network.ts`
- Modify: `.gitignore`
- Create: `.private.example/kiwivm.env.example`
- Create: `docs/operations/kiwivm-traffic-monitoring.md`

- [ ] **Step 1: Write failing route-contract tests around a pure route handler helper**

Extend `server/test/kiwivm-traffic.test.ts` to cover an exported `createKiwiVmTrafficHandler` dependency boundary:

- missing/unreadable/placeholder credentials return `{ configured: false, reason: 'credentials_missing' }` with status 200;
- success returns the normalized result;
- `KiwiVmError` returns its safe body and 502/504 status;
- unexpected errors map to `KIWIVM_NETWORK_ERROR`, never include input secrets, and produce a log call containing only the error code.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `cd server && node --import tsx --test --test-name-pattern="KiwiVM route" test/*.test.ts`

Expected: FAIL because the handler helper does not exist.

- [ ] **Step 3: Implement and register the route**

Add the handler helper to `kiwivm-traffic.ts`, with dependencies for credential-file reading, the traffic client, and sanitized logging. In `server/src/routes/network.ts`, resolve the repository-root path relative to `import.meta.url`, register `GET /api/network/kiwivm-traffic`, pass Fastify's structured logger, and send the helper's status/body without logging thrown objects or raw responses.

- [ ] **Step 4: Add credential safeguards and operator documentation**

Append `.private/` to `.gitignore`. Create `.private.example/kiwivm.env.example` with placeholders only. Document:

```bash
mkdir -p .private
cp .private.example/kiwivm.env.example .private/kiwivm.env
chmod 600 .private/kiwivm.env
```

Explain candidate-A calculation, the multiplier calibration step against the logged-in KiwiVM panel, five-minute caching, and that the API is read-only.

- [ ] **Step 5: Verify ignore and secret hygiene**

Run:

```bash
git check-ignore .private/kiwivm.env
git diff --check
rg -n "KIWIVM_API_KEY=" . -g '!node_modules' -g '!.git' | rg -v "replace_me"
```

Expected: the private file path is ignored; diff check passes; secret scan returns no matches.

- [ ] **Step 6: Run server tests and build**

Run: `cd server && npm test && npm run build`

Expected: PASS and TypeScript exits 0.

- [ ] **Step 7: Commit Task 3**

```bash
git add .gitignore .private.example/kiwivm.env.example docs/operations/kiwivm-traffic-monitoring.md server/src/routes/network.ts server/src/routes/kiwivm-traffic.ts server/test/kiwivm-traffic.test.ts
git commit -m "feat: expose KiwiVM traffic status"
```

### Task 4: Format and render KiwiVM status in the network sidebar

**Files:**
- Modify: `client/src/api.ts`
- Create: `client/src/components/kiwivm-format.ts`
- Create: `client/test/kiwivm-format.test.ts`
- Modify: `client/src/components/NetworkPage.tsx`

- [ ] **Step 1: Write failing formatter tests**

Assert deterministic results for:

```ts
assert.equal(formatTrafficBytes(102.31 * 1024 ** 3), '102.31 GiB');
assert.equal(formatTrafficBytes(2 * 1024 ** 4), '2.00 TiB');
assert.equal(formatUsagePercent(20.456), '20.46%');
assert.equal(
  formatShanghaiResetTime(Date.UTC(2026, 8, 3, 0, 0, 0)),
  '2026-09-03 08:00:00 Asia/Shanghai',
);
```

Also cover zero bytes and the GiB/TiB boundary.

- [ ] **Step 2: Run client test and verify RED**

Run: `cd client && node --import tsx --test --test-name-pattern="KiwiVM" test/*.test.ts`

Expected: FAIL because `kiwivm-format.ts` does not exist.

- [ ] **Step 3: Implement minimal pure formatters**

Use `Intl.DateTimeFormat` with `{ timeZone: 'Asia/Shanghai', hour12: false }`, reconstruct the stable `YYYY-MM-DD HH:mm:ss` string from `formatToParts`, and append `Asia/Shanghai`. Use IEC divisors and two decimal places.

- [ ] **Step 4: Verify formatter GREEN**

Run: `cd client && node --import tsx --test --test-name-pattern="KiwiVM" test/*.test.ts`

Expected: all focused tests PASS.

- [ ] **Step 5: Add typed browser API contracts**

In `client/src/api.ts`, define/export the Clash and KiwiVM success/unconfigured/error unions matching the server spec. Replace `getFlClash` with `getClashStatus`, and add `getKiwiVmTraffic`. Parse non-2xx JSON responses so the expected card-local error payload is returned rather than throwing solely because of status.

- [ ] **Step 6: Render the cards and lifecycle behavior**

In `NetworkPage.tsx`:

- rename all state/functions/types from FlClash to Clash status;
- label the card `Clash Verge` and remove the hard-coded version;
- fetch both card APIs independently on mount;
- refresh KiwiVM every five minutes and retain the existing 30-second network proxy refresh;
- render the KiwiVM card immediately below Clash Verge;
- include hostname, location, used/total/remaining, percentage/progress, Shanghai reset time, severity, suspension/policy warnings, and multiplier calibration note;
- render `待配置凭据` and `.private/kiwivm.env` when unconfigured;
- render only the safe API message for a KiwiVM error;
- keep all other sidebar sections functional if either status fetch fails.

- [ ] **Step 7: Run client tests and build**

Run: `cd client && npm test && npm run build`

Expected: all tests PASS and the Vite production build exits 0.

- [ ] **Step 8: Commit Task 4**

```bash
git add client/src/api.ts client/src/components/kiwivm-format.ts client/test/kiwivm-format.test.ts client/src/components/NetworkPage.tsx
git commit -m "feat: show KiwiVM traffic in network overview"
```

### Task 5: Full verification and visual check

**Files:**
- Verify all files changed by Tasks 1–4.

- [ ] **Step 1: Run all automated checks freshly**

Run:

```bash
cd server && npm test && npm run build
cd ../client && npm test && npm run build
cd .. && git diff --check
```

Expected: zero test failures, both builds exit 0, and no whitespace errors.

- [ ] **Step 2: Verify secret and legacy-name hygiene**

Run:

```bash
git check-ignore .private/kiwivm.env
rg -n "com\.follow\.clash|FlClash|/api/flclash" server/src client/src
rg -n "KIWIVM_API_KEY=" . -g '!node_modules' -g '!.git' | rg -v "replace_me"
```

Expected: private path is ignored; both searches return no matches.

- [ ] **Step 3: Start the application and inspect the unconfigured UI**

Start the server and client using the repository's normal development commands. Open `http://localhost:5173/#network`. Compare the Clash Verge card with the current allowlisted values in the local Clash Verge `config.yaml` rather than assuming they remain fixed, and confirm the KiwiVM card displays `待配置凭据` plus `.private/kiwivm.env` without breaking network status.

- [ ] **Step 4: Review the final diff against the spec**

Check every acceptance criterion in `docs/superpowers/specs/2026-08-13-clash-verge-kiwivm-network-overview-design.md`. Do not claim real billing-calculation calibration until the user supplies credentials and compares the card to the KiwiVM panel.

- [ ] **Step 5: Request code review and resolve Critical/Important findings**

Dispatch a code-reviewer with the spec, plan, base SHA, and final SHA. Apply valid Critical/Important findings, rerun affected tests and builds, and re-review if necessary.

- [ ] **Step 6: Commit any final review fixes**

```bash
git add <only files changed by review fixes>
git commit -m "fix: address network overview review"
```
