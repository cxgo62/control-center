# iStoreOS Read-Only Service Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a five-minute, SSH/Xray/SOCKS-proxy read-only iStoreOS monitor as a same-height card in the Services page network infrastructure section.

**Architecture:** A focused server monitor executes one fixed SSH command through an injected executor, parses only allowlisted Xray/proxy fields, persists a standard service check, and coalesces overlapping probes. The existing services route exposes a discriminated iStoreOS record and permits only `probe`; the client renders a specialized 280px card without changing ordinary cards.

**Tech Stack:** TypeScript, Fastify, Node `child_process.execFile`, better-sqlite3, React, Node built-in test runner, Vite.

---

### Task 1: Build the read-only iStoreOS probe module

**Files:**
- Create: `server/src/istoreos-monitor.ts`
- Create: `server/test/istoreos-monitor.test.ts`
- Modify: `server/src/config.ts` (add the typed monitor configuration only if needed by the module)

- [ ] **Step 1: Write failing parser and status tests**

Add tests for:

```typescript
parseIStoreOSProbeOutput('xray=1\nproxy=204 0.123\n')
// { xrayOk: true, proxyOk: true, proxyLatencyMs: 123 }
```

Cover healthy output, missing Xray, non-204 proxy output, curl failure, curl timeout, malformed output, a rejected SSH executor mapping to `offline`, and the initial `checking` result before the first completed probe. Assert that raw stdout/stderr and private-key-like strings never appear in the normalized result. Capture the executor arguments and assert `-i`, `IdentitiesOnly=yes`, `BatchMode=yes`, `ConnectTimeout=5`, the fixed host, no `StrictHostKeyChecking=no`, and no shell execution. Include a deferred executor test proving concurrent callers share one in-flight SSH operation.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --import tsx --test test/istoreos-monitor.test.ts`

Expected: FAIL because `server/src/istoreos-monitor.ts` does not exist.

- [ ] **Step 3: Implement the minimal parser and probe**

Implement:

- a fixed configuration for display name `iStoreOS 软路由`, subtitle `iStoreOS 21.02.3 · PassWall2 / Xray`, management URL `http://192.168.31.10/`, host `192.168.31.10`, port `22`, user `root`, identity path `/Users/cx/.ssh/id_ed25519`, and SOCKS port `1070`;
- `execFile('ssh', args, { timeout: 25_000, maxBuffer })` with `IdentitiesOnly=yes`, `BatchMode=yes`, and `ConnectTimeout=5`;
- a fixed remote command that checks `pgrep -f '/tmp/etc/passwall2/bin/xray run'` and runs `curl --noproxy '' --proxy socks5h://127.0.0.1:1070 --connect-timeout 8 --max-time 15` against Google `generate_204`; `--noproxy ''` is required so router environment variables cannot bypass the SOCKS proxy;
- safe parsing of `xray=1|0` and `proxy=<status> <seconds>`;
- overall mapping to `running`, `error`, or `stopped` plus safe detail fields;
- a five-minute scheduler helper and in-flight promise coalescing;
- persistence through an injected `persist(serviceId, status, latencyMs)` callback.

Never return or log raw child-process output. Use the existing structured logger only for stable event codes, normalized outcome, and duration.

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `node --import tsx --test test/istoreos-monitor.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the monitor unit**

```bash
git add server/src/istoreos-monitor.ts server/test/istoreos-monitor.test.ts server/src/config.ts
git commit -m "feat: add read-only iStoreOS probe"
```

### Task 2: Integrate the monitor with service configuration, scheduler, and safe actions

**Files:**
- Modify: `server/src/config.ts`
- Modify: `server/src/checker.ts`
- Modify: `server/src/routes/services.ts`
- Modify: `server/src/index.ts`
- Modify: `server/test/config.test.ts`
- Create: `server/test/services-istoreos.test.ts`

- [ ] **Step 1: Write failing configuration and action tests**

Assert that the first infrastructure service is the iStoreOS record with `kind: 'istoreos'`, the management URL, read-only monitor configuration, and no logs. Add route-level tests that `probe` is accepted and `start`, `stop`, and `restart` return a client error without invoking a management command. Add a test that ordinary service checks remain on the existing 30-second path while the iStoreOS monitor is scheduled at five minutes.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `node --import tsx --test test/config.test.ts test/services-istoreos.test.ts`

Expected: FAIL because the service record, scheduler injection, and read-only route guard are not implemented.

- [ ] **Step 3: Implement integration**

Add `monitor: { kind: 'istoreos', ... }`, `kind`, and read-only metadata to the server service configuration. Register the router as the first `infra` service.

Update service checking so the ordinary 30-second `checkAllServices` path skips the specialized record. Create one monitor instance in `server/src/index.ts`, expose a neutral `checking` detail state before its first completion, run it once at startup, then every `300_000` ms, update the existing latest-status map, and clear the timer during shutdown. For compatibility with the existing overview/status union, the top-level service `status` remains `stopped` until the first result; the specialized card must prefer `monitor.state === 'checking'` and show `检查中`, so it never presents that initial state as `已停止`. Pass the instance to the services route. Persist each completed router result under a stable service ID using the existing `insertServiceCheck` mapping (`running` for healthy, `error` for proxy_error, `stopped` for offline); never persist the neutral checking state.

Extend the services route response builder with the normalized iStoreOS detail object. Route `probe` through the monitor and persist an event; reject all mutating actions and reject the router log endpoint without touching the router. Keep ordinary service behavior unchanged. Confirm that the existing Services page `探测全部服务` loop includes the router service ID and therefore triggers the specialized `probe` branch once without bypassing the five-minute scheduler.

- [ ] **Step 4: Run the focused tests and verify they pass**

Run: `node --import tsx --test test/config.test.ts test/services-istoreos.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the server integration**

```bash
git add server/src/config.ts server/src/checker.ts server/src/routes/services.ts server/src/index.ts server/test/config.test.ts server/test/services-istoreos.test.ts
git commit -m "feat: expose iStoreOS as read-only service"
```

### Task 3: Add typed API data and pure card-view helpers

**Files:**
- Modify: `client/src/types.ts`
- Modify: `client/src/api.ts`
- Create: `client/src/components/istoreos-card.ts`
- Create: `client/test/istoreos-card.test.ts`

- [ ] **Step 1: Write failing client model tests**

Test the iStoreOS discriminator, status labels for healthy/proxy-error/offline/checking, check-row labels, and the invariant that the specialized card uses `SERVICE_CARD_HEIGHT` (`280`). Test that a management URL is preserved only as a link target and no start/stop/restart/log action list is produced.

- [ ] **Step 2: Run the focused client test and verify it fails**

Run: `node --import tsx --test test/istoreos-card.test.ts`

Expected: FAIL because the typed monitor fields and helper module do not exist.

- [ ] **Step 3: Implement the minimal typed model and helpers**

Add a discriminated `ServiceInfo` union with an iStoreOS monitor detail shape containing overall state, SSH/Xray/proxy booleans, proxy latency, and last probe timestamp. Type `api.getServices` as `Promise<ServiceInfo[]>`.

Create pure helpers for status metadata, current check rows, and management action visibility. Do not add a generic remote-device abstraction.

- [ ] **Step 4: Run the focused client test and verify it passes**

Run: `node --import tsx --test test/istoreos-card.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the client model**

```bash
git add client/src/types.ts client/src/api.ts client/src/components/istoreos-card.ts client/test/istoreos-card.test.ts
git commit -m "feat: type iStoreOS service card state"
```

### Task 4: Render the same-height read-only card in Services

**Files:**
- Modify: `client/src/components/ServicesPage.tsx`
- Modify: `client/src/components/Shared.tsx` only if a narrowly scoped shared link/action helper is required
- Modify: `client/test/service-card-layout.test.ts` only to lock the unchanged height contract if necessary

- [ ] **Step 1: Write failing rendering-contract tests**

Extend pure layout assertions to verify the iStoreOS card uses 280px and ordinary card constants remain unchanged. Add a test for the service-section selection helper: ordinary infra services use `C_Card`; only `kind: 'istoreos'` uses the specialized card.

- [ ] **Step 2: Run the focused client tests and verify they fail**

Run: `node --import tsx --test test/service-card-layout.test.ts test/istoreos-card.test.ts`

Expected: FAIL because the specialized card is not wired into `ServicesPage`.

- [ ] **Step 3: Implement the card and wiring**

Create a focused `IStoreOSCard` that reuses the existing card visual language and exact `SERVICE_CARD_HEIGHT`. Render the exact display name, subtitle, management URL, header, status pill, 24-hour bar, three check rows, proxy latency/last check, and only `立即探测` plus the management-page link. Use an anchor with `target="_blank"` and `rel="noreferrer"` (or an equivalent safe implementation).

Change `C_Section` to select the specialized card by discriminator while leaving `C_Card` untouched. Keep the router under `infra`, in the first row according to the existing grid order. Ensure global overview counts use the top-level mapped status and the router never reaches `ServiceActions`.

- [ ] **Step 4: Run focused client tests and TypeScript build**

Run: `node --import tsx --test test/service-card-layout.test.ts test/istoreos-card.test.ts` and `npm run build` from `client`.

Expected: PASS and a successful Vite production build.

- [ ] **Step 5: Commit the client card**

```bash
git add client/src/components/ServicesPage.tsx client/src/components/istoreos-card.ts client/test/istoreos-card.test.ts client/test/service-card-layout.test.ts
git commit -m "feat: add iStoreOS service card"
```

### Task 5: Full verification and safe handoff

**Files:**
- Modify: documentation only if implementation details require a correction in `docs/superpowers/specs/2026-08-14-istoreos-read-only-service-card-design.md`

- [ ] **Step 1: Run the full server test suite serially**

Run: `node --import tsx --test --test-concurrency=1 test/*.test.ts` from `server`.

Expected: all non-network-listener tests pass. The two existing tests that bind `127.0.0.1` may require the approved escalated test environment.

- [ ] **Step 2: Run the full client test suite**

Run: `npm test` from `client`.

Expected: all tests pass.

- [ ] **Step 3: Build both packages**

Run: `npm run build` from `server`, then `npm run build` from `client`.

Expected: both TypeScript/Vite builds exit 0.

- [ ] **Step 4: Perform one manual real-device read-only probe**

After confirming the backend user has a trusted `known_hosts` entry, run the monitor's normal `probe` path once against `192.168.31.10`. Verify the result is limited to SSH/Xray/SOCKS-proxy fields and that no private-key content, remote command text, or raw stderr is printed. Do not execute any service-management action.

- [ ] **Step 5: Review the diff for safety and scope**

Run: `git diff --check`, `git status --short`, and `git diff main...HEAD --stat`.

Confirm there is no private-key content, no raw SSH output, no mutation command for iStoreOS, and no existing-card height change.

- [ ] **Step 6: Commit any final documentation correction and report evidence**

Do not claim completion until the fresh verification commands above provide evidence. Keep the worktree and branch for the user’s integration choice.
