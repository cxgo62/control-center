import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { NET_LATENCY_SERIES } from '../src/config.js';
import networkRoutes from '../src/routes/network.js';
import type { VpsLineDiscoveryState } from '../src/vps-line/monitor.js';

const NOW = 10_000_000;

type Sample = {
  id: number;
  probedAt: number;
  nodeName: string;
  sent: number;
  received: number;
  medianLatencyMs: number | null;
  p95LatencyMs: number | null;
  jitterMs: number | null;
  tcpState: 'up' | 'down';
  icmpUsable: boolean;
};

async function buildApp(options: {
  discoveryState?: VpsLineDiscoveryState;
  samples?: Sample[];
  getSamples?: (nodeName: string, sinceMs: number) => Sample[];
} = {}) {
  const app = Fastify({ logger: false });
  await app.register(networkRoutes, {
    now: () => NOW,
    latencySeries: NET_LATENCY_SERIES,
    getNetProbes: (path: string) => path === 'proxy'
      ? [{ id: 1, dest_id: 'google', path, up: 0, latency_ms: null, probed_at: NOW - 30_000 }]
      : [],
    getGroupStats: () => [],
    getVpsLineSamples: options.getSamples ?? (() => options.samples ?? []),
    vpsLineMonitor: {
      getDiscoveryState: () => options.discoveryState ?? { status: 'unconfigured' },
    },
  });
  return app;
}

function sample(overrides: Partial<Sample> = {}): Sample {
  return {
    id: 1,
    probedAt: NOW - 60_000,
    nodeName: 'private-config-name',
    sent: 10,
    received: 10,
    medianLatencyMs: 100,
    p95LatencyMs: 120,
    jitterMs: 5,
    tcpState: 'up',
    icmpUsable: true,
    ...overrides,
  };
}

test('network data exposes generic configured latency series and removes hard-coded line arrays', async t => {
  const app = await buildApp();
  t.after(() => app.close());

  const response = await app.inject({ method: 'GET', url: '/api/network/data?range=1h' });
  assert.equal(response.statusCode, 200);
  const body = response.json();

  assert.deepEqual(body.latencySeries.map((series: { id: string }) => series.id), [
    'domestic', 'international', 'chatgpt', 'google',
  ]);
  assert.equal(body.latencySeries.every((series: { buckets: unknown[] }) => series.buckets.length === 48), true);
  const google = body.latencySeries.find((series: { id: string }) => series.id === 'google');
  assert.equal(google.buckets.at(-1).latencyMs, null);
  assert.equal(google.buckets.at(-1).hasData, true);
  assert.equal('lineDomestic' in body, false);
  assert.equal('lineInternational' in body, false);
});

test('VPS route returns fixed safe unconfigured and unresolved states without querying samples', async t => {
  let queries = 0;
  const getSamples = () => {
    queries += 1;
    throw new Error('must not query');
  };
  const unconfigured = await buildApp({ getSamples });
  const unresolved = await buildApp({
    discoveryState: { status: 'unresolved', nodeName: 'secret-node-name', code: 'NODE_NOT_FOUND' },
    getSamples,
  });
  t.after(async () => {
    await unconfigured.close();
    await unresolved.close();
  });

  assert.deepEqual((await unconfigured.inject('/api/network/vps-line')).json(), {
    status: 'unconfigured',
    displayLabel: '搬瓦工私人线路',
    message: '私人节点未配置',
  });
  const unresolvedBody = (await unresolved.inject('/api/network/vps-line')).json();
  assert.deepEqual(unresolvedBody, {
    status: 'unresolved',
    displayLabel: '搬瓦工私人线路',
    message: '无法识别私人节点',
  });
  assert.equal(JSON.stringify(unresolvedBody).includes('secret-node-name'), false);
  assert.equal(queries, 0);
});

test('VPS route returns accumulating data with latest metrics, selected-range loss, and explicit empty buckets', async t => {
  const app = await buildApp({
    discoveryState: { status: 'resolved', nodeName: 'private-config-name' },
    samples: [
      sample({ id: 1, probedAt: NOW - 120_000, received: 9 }),
      sample({ id: 2, probedAt: NOW - 60_000, medianLatencyMs: 110, p95LatencyMs: 140, jitterMs: 8 }),
    ],
  });
  t.after(() => app.close());

  const response = await app.inject('/api/network/vps-line?range=1h');
  assert.equal(response.statusCode, 200);
  const body = response.json();

  assert.equal(body.status, 'accumulating');
  assert.deepEqual(body.quality, { state: 'collecting', label: '正在积累线路样本' });
  assert.deepEqual(body.current, {
    hasData: true,
    medianLatencyMs: 110,
    p95LatencyMs: 140,
    jitterMs: 8,
    tcpState: 'up',
    icmpUsable: true,
    probedAt: NOW - 60_000,
    sent: 10,
    lost: 0,
    lossPercent: 0,
  });
  assert.deepEqual(body.rangeSummary, { hasData: true, sent: 20, lost: 1, lossPercent: 5 });
  assert.equal(body.buckets.length, 48);
  assert.deepEqual(body.buckets[0], {
    startAt: NOW - 3_600_000,
    endAt: NOW - 3_525_000,
    hasData: false,
    medianLatencyMs: null,
    p95LatencyMs: null,
    sent: null,
    lost: null,
    lossPercent: null,
    jitterMs: null,
    tcpState: 'unknown',
  });
});

test('VPS route returns available quality using five minutes while range loss sums the selected range', async t => {
  const oldSample = sample({ id: 1, probedAt: NOW - 30 * 60_000, sent: 100, received: 50, medianLatencyMs: 800, p95LatencyMs: 900, jitterMs: 80 });
  const recent = [
    sample({ id: 2, probedAt: NOW - 180_000 }),
    sample({ id: 3, probedAt: NOW - 120_000 }),
    sample({ id: 4, probedAt: NOW - 60_000, sent: 100, received: 99 }),
  ];
  const app = await buildApp({
    discoveryState: { status: 'resolved', nodeName: 'private-config-name' },
    samples: [oldSample, ...recent],
  });
  t.after(() => app.close());

  const body = (await app.inject('/api/network/vps-line?range=1h')).json();
  assert.equal(body.status, 'available');
  assert.deepEqual(body.quality, { state: 'good', label: '质量良好' });
  assert.deepEqual(body.current, {
    hasData: true,
    medianLatencyMs: 100,
    p95LatencyMs: 120,
    jitterMs: 5,
    tcpState: 'up',
    icmpUsable: true,
    probedAt: NOW - 60_000,
    sent: 100,
    lost: 1,
    lossPercent: 1,
  });
  assert.deepEqual(body.rangeSummary, { hasData: true, sent: 220, lost: 51, lossPercent: (51 / 220) * 100 });
  assert.equal(body.buckets.some((bucket: { hasData: boolean }) => bucket.hasData), true);
  assert.equal(JSON.stringify(body).includes('private-config-name'), false);
  assert.equal(JSON.stringify(body).includes('host'), false);
  assert.equal(JSON.stringify(body).includes('port'), false);
});

test('VPS route uses the exact seven-day range and preserves all missing current values as null', async t => {
  let queriedSince = 0;
  const app = await buildApp({
    discoveryState: { status: 'resolved', nodeName: 'private-config-name' },
    getSamples: (_nodeName, sinceMs) => {
      queriedSince = sinceMs;
      return [];
    },
  });
  t.after(() => app.close());

  const body = (await app.inject('/api/network/vps-line?range=7d')).json();
  assert.equal(queriedSince, NOW - 7 * 24 * 60 * 60_000);
  assert.equal(body.status, 'accumulating');
  assert.deepEqual(body.current, {
    hasData: false,
    medianLatencyMs: null,
    p95LatencyMs: null,
    jitterMs: null,
    tcpState: 'unknown',
    icmpUsable: null,
    probedAt: null,
    sent: null,
    lost: null,
    lossPercent: null,
  });
  assert.deepEqual(body.rangeSummary, {
    hasData: false,
    sent: null,
    lost: null,
    lossPercent: null,
  });
  assert.equal(body.buckets.length, 48);
  assert.equal(body.buckets.every((bucket: { hasData: boolean }) => !bucket.hasData), true);
});

test('VPS current metrics keep zero attempts distinct from zero packet loss', async t => {
  const app = await buildApp({
    discoveryState: { status: 'resolved', nodeName: 'private-config-name' },
    samples: [sample({ sent: 0, received: 0, medianLatencyMs: null, p95LatencyMs: null, jitterMs: null, icmpUsable: false })],
  });
  t.after(() => app.close());

  const body = (await app.inject('/api/network/vps-line?range=1h')).json();
  assert.equal(body.current.sent, 0);
  assert.equal(body.current.lost, 0);
  assert.equal(body.current.lossPercent, null);
});

test('VPS route defaults invalid ranges to one hour and maps storage errors to a local safe response', async t => {
  const secret = 'sqlite failed at secret-host.example:1234 with password=hunter2';
  let queriedSince = 0;
  const app = await buildApp({
    discoveryState: { status: 'resolved', nodeName: 'private-config-name' },
    getSamples: (_nodeName, sinceMs) => {
      queriedSince = sinceMs;
      throw new Error(secret);
    },
  });
  t.after(() => app.close());

  const response = await app.inject('/api/network/vps-line?range=invalid');
  assert.equal(response.statusCode, 503);
  assert.equal(queriedSince, NOW - 3_600_000);
  assert.deepEqual(response.json(), {
    status: 'error',
    displayLabel: '搬瓦工私人线路',
    error: { code: 'VPS_LINE_DATA_UNAVAILABLE', message: '线路数据暂时不可用' },
  });
  assert.equal(response.body.includes(secret), false);
});
