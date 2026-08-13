import test from 'node:test';
import assert from 'node:assert/strict';
import { latestProbedAt, latestProbeForTarget, createLivePingEntry } from '../src/routes/network-utils.js';
import { buildBuckets } from '../src/routes/network.js';
import { buildLatencySeries } from '../src/routes/network-series.js';

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

test('buildBuckets returns contiguous bucket time bounds for the requested range', () => {
  const result = buildBuckets([
    { id: 1, dest_id: 'baidu', path: 'direct', up: 1, latency_ms: 100, probed_at: 1000 },
  ], 'baidu', 0, 4800);

  assert.deepEqual(
    { startAt: result.buckets[0].startAt, endAt: result.buckets[0].endAt },
    { startAt: 0, endAt: 100 },
  );
  assert.deepEqual(
    { startAt: result.buckets[47].startAt, endAt: result.buckets[47].endAt },
    { startAt: 4700, endAt: 4800 },
  );
  assert.equal(result.buckets[15].endAt, result.buckets[16].startAt);
});

test('network buckets and generic latency series include a probe exactly at nowMs in the final bucket', () => {
  const nowMs = 4_800;
  const probe = { id: 1, dest_id: 'google', path: 'proxy', up: 1, latency_ms: 42, probed_at: nowMs };
  const destination = buildBuckets([probe], 'google', 0, nowMs);
  const series = buildLatencySeries({
    entries: [
      { id: 'google', label: 'Google', source: { kind: 'target', targetId: 'google', path: 'proxy' }, color: '#123456', order: 1 },
    ],
    sinceMs: 0,
    nowMs,
    getGroupStats: () => [],
    getNetProbes: () => [probe],
    logWarning: () => {},
  });

  assert.deepEqual(destination.buckets.at(-1), {
    startAt: 4_700,
    endAt: 4_800,
    up: true,
    latencyMs: 42,
    hasData: true,
  });
  assert.deepEqual(series[0].buckets.at(-1), {
    startAt: 4_700,
    endAt: 4_800,
    latencyMs: 42,
    hasData: true,
  });
});

test('buildLatencySeries builds configured group and target sources into 48 chronological buckets', () => {
  const warnings: unknown[] = [];
  const groupCalls: string[] = [];
  const probeCalls: string[] = [];
  const result = buildLatencySeries({
    entries: [
      { id: 'domestic', label: '国内', source: { kind: 'group', group: 'domestic', path: 'direct' }, color: '#22c55e', order: 10 },
      { id: 'chatgpt', label: 'ChatGPT', source: { kind: 'target', targetId: 'chatgpt', path: 'proxy' }, color: '#3b82f6', order: 20 },
      { id: 'google', label: 'Google', source: { kind: 'target', targetId: 'google', path: 'proxy' }, color: '#f59e0b', order: 30 },
    ],
    sinceMs: 0,
    nowMs: 4_800,
    getGroupStats: group => {
      groupCalls.push(group);
      return [
        { computed_at: 50, avg_latency_ms: 20 },
        { computed_at: 75, avg_latency_ms: 40 },
        { computed_at: 150, avg_latency_ms: null },
        { computed_at: 250, avg_latency_ms: 0 },
      ];
    },
    getNetProbes: path => {
      probeCalls.push(path);
      return [
        { id: 1, dest_id: 'chatgpt', path, up: 1, latency_ms: 100, probed_at: 50 },
        { id: 2, dest_id: 'chatgpt', path, up: 0, latency_ms: null, probed_at: 150 },
        { id: 3, dest_id: 'chatgpt', path, up: 1, latency_ms: 0, probed_at: 250 },
        { id: 4, dest_id: 'google', path, up: 1, latency_ms: 200, probed_at: 50 },
      ];
    },
    logWarning: warning => warnings.push(warning),
  });

  assert.deepEqual(result.map(series => series.id), ['domestic', 'chatgpt', 'google']);
  assert.deepEqual(groupCalls, ['domestic']);
  assert.deepEqual(probeCalls, ['proxy']);
  assert.equal(warnings.length, 0);
  for (const series of result) {
    assert.equal(series.buckets.length, 48);
    assert.deepEqual(
      { startAt: series.buckets[0].startAt, endAt: series.buckets[0].endAt },
      { startAt: 0, endAt: 100 },
    );
    assert.deepEqual(
      { startAt: series.buckets[47].startAt, endAt: series.buckets[47].endAt },
      { startAt: 4_700, endAt: 4_800 },
    );
  }
  assert.deepEqual(result[0].buckets.slice(0, 3), [
    { startAt: 0, endAt: 100, latencyMs: 30, hasData: true },
    { startAt: 100, endAt: 200, latencyMs: null, hasData: true },
    { startAt: 200, endAt: 300, latencyMs: 0, hasData: true },
  ]);
  assert.deepEqual(result[1].buckets.slice(0, 3), [
    { startAt: 0, endAt: 100, latencyMs: 100, hasData: true },
    { startAt: 100, endAt: 200, latencyMs: null, hasData: true },
    { startAt: 200, endAt: 300, latencyMs: 0, hasData: true },
  ]);
});

test('buildLatencySeries derives noncanonical group paths from target probes', () => {
  const warnings: unknown[] = [];
  const probeCalls: string[] = [];
  const result = buildLatencySeries({
    entries: [
      { id: 'domestic-proxy', label: 'Domestic proxy', source: { kind: 'group', group: 'domestic', path: 'proxy' }, color: '#123456', order: 1 },
      { id: 'international-direct', label: 'International direct', source: { kind: 'group', group: 'international', path: 'direct' }, color: '#654321', order: 2 },
    ],
    sinceMs: 0,
    nowMs: 4_800,
    getGroupStats: () => { throw new Error('noncanonical groups must use path probes'); },
    getNetProbes: path => {
      probeCalls.push(path);
      return path === 'proxy' ? [
        { id: 1, dest_id: 'baidu', path, up: 1, latency_ms: 50, probed_at: 50 },
        { id: 2, dest_id: 'bilibili', path, up: 1, latency_ms: 70, probed_at: 50 },
        { id: 3, dest_id: 'google', path, up: 1, latency_ms: 900, probed_at: 50 },
        { id: 4, dest_id: 'baidu', path, up: 0, latency_ms: null, probed_at: 150 },
      ] : [
        { id: 5, dest_id: 'google', path, up: 1, latency_ms: 100, probed_at: 50 },
        { id: 6, dest_id: 'chatgpt', path, up: 1, latency_ms: 300, probed_at: 50 },
        { id: 7, dest_id: 'baidu', path, up: 1, latency_ms: 10, probed_at: 50 },
      ];
    },
    logWarning: warning => warnings.push(warning),
  });

  assert.deepEqual(result.map(series => series.id), ['domestic-proxy', 'international-direct']);
  assert.deepEqual(probeCalls, ['proxy', 'direct']);
  assert.deepEqual(warnings, []);
  assert.deepEqual(result[0].buckets.slice(0, 3), [
    { startAt: 0, endAt: 100, latencyMs: 60, hasData: true },
    { startAt: 100, endAt: 200, latencyMs: null, hasData: true },
    { startAt: 200, endAt: 300, latencyMs: null, hasData: false },
  ]);
  assert.equal(result[1].buckets[0].latencyMs, 200);
});

test('buildLatencySeries skips invalid series with sanitized warnings', () => {
  const secret = 'secret-host.example:1234';
  const warnings: unknown[] = [];
  const result = buildLatencySeries({
    entries: [
      { id: 'bad-color', label: secret, source: { kind: 'target', targetId: 'google', path: 'proxy' }, color: secret, order: 1 },
      { id: 'password=hunter2', label: 'Unsafe ID', source: { kind: 'target', targetId: 'google', path: 'proxy' }, color: '#123456', order: 2 },
      { id: 'good', label: 'Good', source: { kind: 'target', targetId: 'google', path: 'proxy' }, color: '#654321', order: 3 },
    ],
    sinceMs: 0,
    nowMs: 4_800,
    getGroupStats: () => { throw new Error('unsupported group must not query'); },
    getNetProbes: () => [],
    logWarning: warning => warnings.push(warning),
  });

  assert.deepEqual(result.map(series => series.id), ['good']);
  assert.deepEqual(warnings, [
    { code: 'NETWORK_LATENCY_SERIES_SKIPPED', seriesId: 'bad-color', reason: 'invalid-color' },
    { code: 'NETWORK_LATENCY_SERIES_SKIPPED', seriesId: null, reason: 'invalid-id' },
  ]);
  assert.equal(JSON.stringify(warnings).includes(secret), false);
  assert.equal(JSON.stringify(warnings).includes('hunter2'), false);
});
