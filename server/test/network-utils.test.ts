import test from 'node:test';
import assert from 'node:assert/strict';
import { latestProbedAt, latestProbeForTarget, createLivePingEntry } from '../src/routes/network-utils.js';
import { buildBuckets } from '../src/routes/network.js';

test('latestProbedAt handles large probe sets without overflowing the call stack', () => {
  const fallback = 1000;
  const probes = Array.from({ length: 200_000 }, (_, i) => ({ probed_at: fallback + i }));

  assert.equal(latestProbedAt(probes, fallback), fallback + probes.length - 1);
});

test('latestProbedAt returns fallback when there are no probes', () => {
  assert.equal(latestProbedAt([], 1234), 1234);
});

test('latestProbeForTarget returns the latest probe for only the requested target', () => {
  const probes = [
    { dest_id: 'baidu', probed_at: 100 },
    { dest_id: 'bilibili', probed_at: 500 },
    { dest_id: 'baidu', probed_at: 300 },
  ];

  assert.deepEqual(latestProbeForTarget(probes, 'baidu'), { dest_id: 'baidu', probed_at: 300 });
  assert.equal(latestProbeForTarget(probes, 'missing'), null);
});

test('createLivePingEntry preserves its probe completion timestamp', () => {
  assert.deepEqual(
    createLivePingEntry('baidu', 'direct', 'domestic', { up: true, latencyMs: 123 }, 456),
    { id: 'baidu', path: 'direct', group: 'domestic', up: true, latencyMs: 123, probedAt: 456 },
  );
});

test('buildBuckets exposes the latest persisted sampling timestamp', () => {
  const result = buildBuckets([
    { id: 1, dest_id: 'baidu', path: 'direct', up: 1, latency_ms: 100, probed_at: 1000 },
    { id: 2, dest_id: 'baidu', path: 'direct', up: 1, latency_ms: 120, probed_at: 2000 },
  ], 'baidu', 0, 3000);

  assert.equal(result.probedAt, 2000);
});
