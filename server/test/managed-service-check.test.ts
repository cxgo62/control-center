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
