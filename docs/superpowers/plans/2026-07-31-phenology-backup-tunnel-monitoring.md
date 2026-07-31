# Phenology Backup and Tunnel Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add monitored Control Center cards for the Phenology backup/Codex worker and bidirectional primary SSH tunnel, including strict runtime health assertions and launchd controls.

**Architecture:** Keep the cards configuration-driven through the existing `SERVICES` array. Add a small reusable HTTP health module for status and recursive partial-JSON assertions, plus a focused launchd module for status/management commands; `checker.ts` remains the orchestrator that combines process state with health state and persistence.

**Tech Stack:** TypeScript, Node.js test runner, Undici fetch, Fastify, React/Vite, macOS launchd.

---

## File map

- Create `server/src/health-check.ts`: reusable HTTP probe and nested JSON assertion logic.
- Create `server/src/launchd.ts`: launchd command construction, status parsing, and start/stop/restart execution.
- Create `server/src/managed-service-check.ts`: side-effect-free launchd/health orchestration with injected persistence.
- Create `server/test/config.test.ts`: exact regression coverage for the two new card definitions.
- Create `server/test/health-check.test.ts`: real local-HTTP tests for assertion success and failure paths.
- Create `server/test/launchd.test.ts`: launchd state parsing and exact command behavior.
- Create `server/test/managed-service-check.test.ts`: launchd process/health/persistence integration behavior without opening the real database.
- Modify `server/src/config.ts`: health configuration types and two service entries.
- Modify `server/src/checker.ts`: use the new health and launchd modules, preserving old services' opt-in semantics.
- Modify `README.md`: document structured health assertions and launchd management.
- Do not modify or stage the unrelated existing changes in `server/start-prod.sh`, `server/supervisor.mjs`, `server/test/supervisor.test.ts`, or `.superpowers/`.

### Task 1: Define and register the two service cards

**Files:**
- Create: `server/test/config.test.ts`
- Modify: `server/src/config.ts:1-105`

- [ ] **Step 1: Write the failing configuration test**

```typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import { SERVICES } from '../src/config.js';

test('registers the Phenology backup worker as a monitored personal app', () => {
  const service = SERVICES.find(candidate => candidate.id === 'phenology-backup');
  assert.deepEqual(service, {
    id: 'phenology-backup',
    name: 'Phenology Backup / Codex Worker',
    group: 'app',
    tech: '备份节点 · 本地 Codex Worker',
    checkUrl: 'http://127.0.0.1:5178/api/system/runtime-status',
    port: ':5178',
    addr: '127.0.0.1:5178',
    url: 'http://127.0.0.1:5178',
    launchAgent: 'top.damkeeper.phenology-backup',
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
    },
    logs: [
      { label: '标准输出', file: '/Users/cx/cx/phenology-backup/.prod/logs/launchd.out.log', glyph: '≡', tone: 'mute' },
      { label: '标准错误', file: '/Users/cx/cx/phenology-backup/.prod/logs/launchd.err.log', glyph: '⚠', tone: 'danger' },
    ],
  });
});

test('registers the primary SSH tunnel as monitored network infrastructure', () => {
  const service = SERVICES.find(candidate => candidate.id === 'phenology-primary-tunnel');
  assert.deepEqual(service, {
    id: 'phenology-primary-tunnel',
    name: 'Phenology Primary Tunnel',
    group: 'infra',
    tech: '双向 SSH 隧道 · 主备互联',
    checkUrl: 'http://127.0.0.1:15177/api/system/runtime-status',
    port: ':15177 / :15178',
    addr: '127.0.0.1:15177',
    launchAgent: 'top.damkeeper.phenology-primary-tunnel',
    health: {
      timeoutMs: 5_000,
      expect: {
        httpStatus: 200,
        json: {
          runtimeRole: 'primary',
          readOnly: false,
          codex: { provider: 'rpc', status: 'available' },
        },
      },
    },
    logs: [
      { label: '标准输出', file: '/Users/cx/cx/phenology-backup/.prod/logs/tunnel.out.log', glyph: '≡', tone: 'mute' },
      { label: '标准错误', file: '/Users/cx/cx/phenology-backup/.prod/logs/tunnel.err.log', glyph: '⚠', tone: 'danger' },
    ],
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `cd server && node --import tsx --test --test-name-pattern='registers the Phenology|registers the primary' test/config.test.ts`

Expected: FAIL because neither service exists.

- [ ] **Step 3: Add the health types and minimal service entries**

Add above `ServiceConfig`:

```typescript
export type JsonExpectation =
  | null
  | boolean
  | number
  | string
  | { [key: string]: JsonExpectation };

export interface ServiceHealthConfig {
  timeoutMs?: number;
  expect?: {
    httpStatus?: number;
    json?: { [key: string]: JsonExpectation };
  };
}
```

Add `health?: ServiceHealthConfig` to `ServiceConfig`, then add the two exact objects from the tests to `SERVICES`. Put the tunnel near the other `infra` services and the backup worker near Phenology in the `app` group.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `cd server && node --import tsx --test --test-name-pattern='registers the Phenology|registers the primary' test/config.test.ts`

Expected: 2 passing tests and no failures.

- [ ] **Step 5: Commit only Task 1 files**

```bash
git add server/src/config.ts server/test/config.test.ts
git commit -m "feat: register phenology backup services"
```

### Task 2: Implement strict HTTP and nested JSON health assertions

**Files:**
- Create: `server/test/health-check.test.ts`
- Create: `server/src/health-check.ts`

- [ ] **Step 1: Write the failing real-HTTP tests**

Use Node's HTTP server so the tests exercise real response parsing and abort behavior rather than mocking fetch:

```typescript
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import test from 'node:test';
import { matchesJsonExpectation, probeHttpHealth } from '../src/health-check.js';

async function listen(handler: Parameters<typeof createServer>[0]): Promise<{ server: Server; url: string }> {
  const server = createServer(handler);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return { server, url: `http://127.0.0.1:${address.port}` };
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

test('matches recursively nested expected JSON while ignoring extra fields', () => {
  assert.equal(matchesJsonExpectation(
    { runtimeRole: 'backup', readOnly: true, codex: { provider: 'local', status: 'available', version: 'x' } },
    { runtimeRole: 'backup', readOnly: true, codex: { provider: 'local', status: 'available' } },
  ), true);
  assert.equal(matchesJsonExpectation(
    { runtimeRole: 'backup', codex: { provider: 'rpc' } },
    { runtimeRole: 'backup', codex: { provider: 'local' } },
  ), false);
  assert.equal(matchesJsonExpectation(
    { runtimeRole: 'backup' },
    { runtimeRole: 'backup', codex: { provider: 'local' } },
  ), false);
});

test('accepts only the expected status and nested runtime body', async t => {
  const { server, url } = await listen((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ runtimeRole: 'backup', readOnly: true, codex: { provider: 'local', status: 'available' }, extra: 1 }));
  });
  t.after(() => close(server));

  const result = await probeHttpHealth(url, {
    timeoutMs: 500,
    expect: { httpStatus: 200, json: { runtimeRole: 'backup', readOnly: true, codex: { provider: 'local', status: 'available' } } },
  });
  assert.equal(result.status, 'running');
  assert.ok(result.latencyMs > 0);
});

test('reports error for wrong status, invalid JSON, mismatched JSON, timeout, and connection failure', async t => {
  const cases = [
    { status: 503, body: '{}' },
    { status: 200, body: 'not-json' },
    { status: 200, body: JSON.stringify({ runtimeRole: 'primary' }) },
  ];
  for (const item of cases) {
    const { server, url } = await listen((_request, response) => {
      response.writeHead(item.status, { 'content-type': 'application/json' });
      response.end(item.body);
    });
    const result = await probeHttpHealth(url, {
      timeoutMs: 100,
      expect: { httpStatus: 200, json: { runtimeRole: 'backup' } },
    });
    assert.equal(result.status, 'error');
    assert.ok(result.latencyMs > 0);
    await close(server);
  }

  const slow = await listen((_request, response) => setTimeout(() => response.end('{}'), 200));
  t.after(() => close(slow.server));
  assert.equal((await probeHttpHealth(slow.url, { timeoutMs: 10, expect: { httpStatus: 200 } })).status, 'error');
  assert.equal((await probeHttpHealth('http://127.0.0.1:1', { timeoutMs: 50, expect: { httpStatus: 200 } })).status, 'stopped');
});
```

- [ ] **Step 2: Run the health tests and verify RED**

Run: `cd server && node --import tsx --test test/health-check.test.ts`

Expected: FAIL because `health-check.ts` does not exist.

- [ ] **Step 3: Implement the minimal reusable health module**

```typescript
import { fetch } from 'undici';
import type { JsonExpectation, ServiceHealthConfig } from './config.js';

export interface HttpProbeResult {
  status: 'running' | 'stopped' | 'error';
  latencyMs: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function matchesJsonExpectation(actual: unknown, expected: JsonExpectation): boolean {
  if (!isRecord(expected)) return Object.is(actual, expected);
  if (!isRecord(actual)) return false;
  return Object.entries(expected).every(([key, value]) =>
    Object.prototype.hasOwnProperty.call(actual, key) && matchesJsonExpectation(actual[key], value)
  );
}

function isConnectionRefused(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const cause = 'cause' in error ? error.cause : undefined;
  return error.message.includes('ECONNREFUSED')
    || (isRecord(cause) && cause.code === 'ECONNREFUSED');
}

export async function probeHttpHealth(url: string, health?: ServiceHealthConfig): Promise<HttpProbeResult> {
  const startedAt = Date.now();
  const elapsedMs = () => Math.max(1, Date.now() - startedAt);
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(health?.timeoutMs ?? 5_000) });
    if (health?.expect?.httpStatus !== undefined && response.status !== health.expect.httpStatus) {
      return { status: 'error', latencyMs: elapsedMs() };
    }
    if (health?.expect?.json !== undefined) {
      const body: unknown = await response.json();
      if (!matchesJsonExpectation(body, health.expect.json)) {
        return { status: 'error', latencyMs: elapsedMs() };
      }
    }
    return { status: 'running', latencyMs: elapsedMs() };
  } catch (error: unknown) {
    return {
      status: isConnectionRefused(error) ? 'stopped' : 'error',
      latencyMs: elapsedMs(),
    };
  }
}
```

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `cd server && node --import tsx --test test/health-check.test.ts`

Expected: all health-check tests pass with no warnings or leaked server handles.

- [ ] **Step 5: Commit only Task 2 files**

```bash
git add server/src/health-check.ts server/test/health-check.test.ts
git commit -m "feat: validate structured service health"
```

### Task 3: Use the supplied launchd status and restart commands

**Files:**
- Create: `server/test/launchd.test.ts`
- Create: `server/src/launchd.ts`
- Modify: `server/src/checker.ts:1-110,235-241`

- [ ] **Step 1: Write failing launchd command tests**

```typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLaunchdTarget, parseLaunchdPrint, checkLaunchAgent, manageLaunchAgent } from '../src/launchd.js';

test('builds the gui launchd target and recognizes running print output', () => {
  assert.equal(buildLaunchdTarget('top.damkeeper.phenology-backup', 501), 'gui/501/top.damkeeper.phenology-backup');
  assert.equal(parseLaunchdPrint('state = running\npid = 123'), 'running');
  assert.equal(parseLaunchdPrint('state = waiting'), 'stopped');
});

test('restarts a launchd job with kickstart -k without bootout', async () => {
  const commands: string[] = [];
  await manageLaunchAgent({
    label: 'top.damkeeper.phenology-primary-tunnel',
    plistPath: '/Users/cx/Library/LaunchAgents/top.damkeeper.phenology-primary-tunnel.plist',
    action: 'restart',
    uid: 501,
    exec: async command => { commands.push(command); },
  });
  assert.deepEqual(commands, [
    'launchctl kickstart -k gui/501/top.damkeeper.phenology-primary-tunnel',
  ]);
});

test('checks launchd state with print and maps a missing job to null', async () => {
  const commands: string[] = [];
  const running = await checkLaunchAgent({
    label: 'top.damkeeper.phenology-backup',
    uid: 501,
    exec: async command => {
      commands.push(command);
      return { stdout: 'state = running\npid = 123' };
    },
  });
  assert.equal(running, 'running');
  assert.deepEqual(commands, ['launchctl print gui/501/top.damkeeper.phenology-backup']);

  const absent = await checkLaunchAgent({
    label: 'missing',
    uid: 501,
    exec: async () => { throw new Error('not found'); },
  });
  assert.equal(absent, null);
});

test('preserves bootstrap start and bootout stop commands', async () => {
  const commands: string[] = [];
  const base = {
    label: 'top.damkeeper.phenology-backup',
    plistPath: '/Users/cx/Library/LaunchAgents/top.damkeeper.phenology-backup.plist',
    uid: 501,
    exec: async (command: string) => { commands.push(command); },
  };
  await manageLaunchAgent({ ...base, action: 'start' });
  await manageLaunchAgent({ ...base, action: 'stop' });
  assert.deepEqual(commands, [
    'launchctl bootstrap gui/501 /Users/cx/Library/LaunchAgents/top.damkeeper.phenology-backup.plist',
    'launchctl bootout gui/501 /Users/cx/Library/LaunchAgents/top.damkeeper.phenology-backup.plist',
  ]);
});
```

- [ ] **Step 2: Run launchd tests and verify RED**

Run: `cd server && node --import tsx --test test/launchd.test.ts`

Expected: FAIL because `launchd.ts` does not exist.

- [ ] **Step 3: Implement launchd helpers and management**

Implement these public boundaries in `server/src/launchd.ts`:

```typescript
export type LaunchdStatus = 'running' | 'stopped';
export type LaunchdAction = 'start' | 'stop' | 'restart';
export type LaunchdExec = (command: string, options: { timeout: number }) => Promise<unknown>;

export function buildLaunchdTarget(label: string, uid: number): string {
  return `gui/${uid}/${label}`;
}

export function parseLaunchdPrint(output: string): LaunchdStatus {
  return /^\s*state\s*=\s*running\s*$/m.test(output) ? 'running' : 'stopped';
}
```

Also expose a status execution boundary:

```typescript
export async function checkLaunchAgent(options: {
  label: string;
  uid: number;
  exec: LaunchdExec;
}): Promise<LaunchdStatus | null> {
  try {
    const result = await options.exec(
      `launchctl print ${buildLaunchdTarget(options.label, options.uid)}`,
      { timeout: 3_000 },
    ) as { stdout?: string };
    return parseLaunchdPrint(result.stdout ?? '');
  } catch {
    return null;
  }
}
```

`manageLaunchAgent` must:

- call `launchctl kickstart -k <target>` for restart;
- call `launchctl bootout gui/<uid> <plistPath>` for stop;
- call `launchctl bootstrap gui/<uid> <plistPath>` for start;
- use a 10-second timeout for each command.

Move the existing launchd command execution out of `checker.ts`. Have status lookup delegate to `checkLaunchAgent` and service actions delegate to `manageLaunchAgent`, both with the current UID and `execAsync`.

- [ ] **Step 4: Run launchd tests and verify GREEN**

Run: `cd server && node --import tsx --test test/launchd.test.ts`

Expected: all launchd tests pass.

- [ ] **Step 5: Run server TypeScript build**

Run: `cd server && npm run build`

Expected: exit 0. Fix only type errors introduced by Task 3.

- [ ] **Step 6: Commit only Task 3 files**

```bash
git add server/src/launchd.ts server/src/checker.ts server/test/launchd.test.ts
git commit -m "feat: manage launchd jobs by gui target"
```

### Task 4: Combine launchd process state, strict health state, and persistence

**Files:**
- Create: `server/test/managed-service-check.test.ts`
- Create: `server/src/managed-service-check.ts`
- Modify: `server/src/checker.ts:1-37,170-224`

- [ ] **Step 1: Write the failing managed-service integration tests**

Exercise the complete launchd decision path with injected process lookup, HTTP probe, clock, and persistence so the test neither invokes launchctl nor opens the real SQLite database:

```typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import { checkManagedLaunchAgent } from '../src/managed-service-check.js';

const service = {
  id: 'phenology-backup',
  health: {
    timeoutMs: 5_000,
    expect: { httpStatus: 200, json: { runtimeRole: 'backup' } },
  },
};

test('persists error and measured latency when a running launchd job fails required health', async () => {
  const writes: Array<[string, string, number | null]> = [];
  const result = await checkManagedLaunchAgent(service, {
    checkProcess: async () => 'running',
    probeHealth: async () => ({ status: 'error', latencyMs: 37 }),
    persist: (id, status, latencyMs) => writes.push([id, status, latencyMs]),
    now: () => 123_456,
  });
  assert.deepEqual(result, {
    id: 'phenology-backup', status: 'error', latencyMs: 37, checkedAt: 123_456,
  });
  assert.deepEqual(writes, [['phenology-backup', 'error', 37]]);
});

test('persists running and measured latency when required health passes', async () => {
  const writes: Array<[string, string, number | null]> = [];
  const result = await checkManagedLaunchAgent(service, {
    checkProcess: async () => 'running',
    probeHealth: async () => ({ status: 'running', latencyMs: 19 }),
    persist: (id, status, latencyMs) => writes.push([id, status, latencyMs]),
    now: () => 123_456,
  });
  assert.equal(result.status, 'running');
  assert.equal(result.latencyMs, 19);
  assert.deepEqual(writes, [['phenology-backup', 'running', 19]]);
});

test('does not probe a stopped launchd job and persists stopped', async () => {
  let probed = false;
  const writes: Array<[string, string, number | null]> = [];
  const result = await checkManagedLaunchAgent(service, {
    checkProcess: async () => 'stopped',
    probeHealth: async () => { probed = true; return { status: 'running', latencyMs: 1 }; },
    persist: (id, status, latencyMs) => writes.push([id, status, latencyMs]),
    now: () => 123_456,
  });
  assert.equal(probed, false);
  assert.equal(result.status, 'stopped');
  assert.deepEqual(writes, [['phenology-backup', 'stopped', null]]);
});

test('preserves process authority for legacy launchd services without assertions', async () => {
  const result = await checkManagedLaunchAgent({ id: 'legacy' }, {
    checkProcess: async () => 'running',
    probeHealth: async () => ({ status: 'error', latencyMs: 22 }),
    persist: () => {},
    now: () => 123_456,
  });
  assert.deepEqual(result, {
    id: 'legacy', status: 'running', latencyMs: 0, checkedAt: 123_456,
  });
});
```

- [ ] **Step 2: Run the integration tests and verify RED**

Run: `cd server && node --import tsx --test test/managed-service-check.test.ts`

Expected: FAIL because `managed-service-check.ts` does not exist.

- [ ] **Step 3: Implement the side-effect-free managed-service orchestrator**

Create `checkManagedLaunchAgent` with these boundaries:

```typescript
type StableServiceStatus = 'running' | 'stopped' | 'error';

interface ManagedServiceInput {
  id: string;
  health?: ServiceHealthConfig;
}

interface ManagedServiceDependencies {
  checkProcess: () => Promise<'running' | 'stopped' | null>;
  probeHealth: () => Promise<HttpProbeResult>;
  persist: (id: string, status: StableServiceStatus, latencyMs: number | null) => void;
  now: () => number;
}
```

The function must:

1. Map absent/stopped process state to `stopped`, skip probing, and persist null latency.
2. Probe exactly once when the process is running.
3. For services with `health`, map any non-running probe to `error` and preserve/persist its elapsed latency.
4. For legacy services without `health`, keep process status `running`; retain probe latency only when the probe succeeds.
5. Return `{ id, status, latencyMs, checkedAt: now() }` after persistence.

- [ ] **Step 4: Run the integration tests and verify GREEN**

Run: `cd server && node --import tsx --test test/managed-service-check.test.ts`

Expected: all four managed-service tests pass without creating or modifying `data.db`.

- [ ] **Step 5: Wire the orchestrator into the production checker**

Replace the private `httpProbe` with `probeHttpHealth` imported from `health-check.ts`. In the macOS launchd branch, return `checkManagedLaunchAgent(svc, deps)` using:

- `checkLaunchAgent({ label, uid, exec: execAsync })` for `checkProcess`;
- `probeHttpHealth(checkUrl, svc.health)` for `probeHealth`;
- `insertServiceCheck` for `persist`;
- `Date.now` for `now`.

Pass `svc.health` in the systemd, brew, and HTTP-only branches as well, but preserve existing process-manager authority when `svc.health` is absent. Do not add retries or new UI states.

- [ ] **Step 6: Run managed-service and health tests after wiring**

Run: `cd server && node --import tsx --test test/managed-service-check.test.ts test/health-check.test.ts test/launchd.test.ts`

Expected: all focused tests pass.

- [ ] **Step 7: Run all server tests and the TypeScript build**

Run: `cd server && npm test && npm run build`

Expected: all tests pass, including the user's pre-existing supervisor tests, and TypeScript exits 0.

- [ ] **Step 8: Commit only Task 4 files**

```bash
git add server/src/managed-service-check.ts server/src/checker.ts server/test/managed-service-check.test.ts
git commit -m "feat: enforce managed service health assertions"
```

### Task 5: Document, verify, and visually inspect the cards

**Files:**
- Modify: `README.md:19-57,85-94`

- [ ] **Step 1: Update service configuration documentation**

Add `launchAgent`, `health.timeoutMs`, `health.expect.httpStatus`, and recursively nested `health.expect.json` to the sample. Document that configured assertions turn a running managed process into `error` when HTTP or JSON validation fails, and that launchd restart uses `kickstart -k`.

- [ ] **Step 2: Run formatting and repository-diff checks**

Run: `git diff --check`

Expected: no whitespace errors.

Run: `git status --short`

Expected: only Task 5's README plus the user's unrelated pre-existing files are uncommitted; confirm none of those unrelated files is staged.

- [ ] **Step 3: Run the complete automated verification suite**

Run: `cd server && npm test && npm run build`

Expected: all server tests pass and TypeScript exits 0.

Run: `cd client && npm test && npm run build`

Expected: all client tests pass and the production Vite build exits 0.

- [ ] **Step 4: Start the development stack and inspect API output**

Run the server and client through their existing development commands in separate managed terminal sessions:

```bash
npm run dev:server
npm run dev:client
```

Then run:

```bash
curl -sS http://127.0.0.1:9000/api/services
```

Expected: the JSON includes `phenology-backup` in group `app` and `phenology-primary-tunnel` in group `infra`; on this host each reports `running` only when both launchd state and its complete health assertion pass, otherwise `error` or `stopped` according to the design.

- [ ] **Step 5: Inspect the rendered Services page**

Open `http://127.0.0.1:5173/#services` and confirm:

- the tunnel card appears under 网络基建;
- the backup/Codex worker card appears under 个人应用;
- both show their port/address, status strip, probe/restart actions, and two log buttons;
- only the backup card shows an Open action;
- the overview total includes both new services;
- the page has no overflow or overlap at the current desktop viewport.

Stop both development sessions after inspection with Ctrl-C (or the terminal session's interrupt operation) and confirm ports 9000 and 5173 are no longer owned by the temporary processes.

- [ ] **Step 6: Commit only the documentation**

```bash
git add README.md
git commit -m "docs: describe structured service health"
```

- [ ] **Step 7: Perform the final scope audit**

Run: `git status --short` and `git diff HEAD~5..HEAD --stat`.

Expected: feature commits contain only the planned config, health, launchd, checker, tests, and README files. The unrelated pre-existing work remains untouched and uncommitted.
