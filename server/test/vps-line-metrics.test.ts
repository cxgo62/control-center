import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateVpsBucket, classifyVpsLineQuality, calculateRoundMetrics } from '../src/vps-line/metrics.js';

test('calculates exact round median, P95, and mean adjacent jitter', () => {
  assert.deepEqual(calculateRoundMetrics([10, 20, 30, 100]), { medianLatencyMs: 25, p95LatencyMs: 100, jitterMs: 30 });
  assert.deepEqual(calculateRoundMetrics([]), { medianLatencyMs: null, p95LatencyMs: null, jitterMs: null });
});

test('requires three rounds before good or degraded quality', () => {
  const sample = { probedAt: 1, sent: 10, received: 10, medianLatencyMs: 100, p95LatencyMs: 100, jitterMs: 5, tcpState: 'up' as const };
  assert.deepEqual(classifyVpsLineQuality([sample, { ...sample, probedAt: 2 }], 2), { state: 'collecting' });
  assert.deepEqual(classifyVpsLineQuality([sample, { ...sample, probedAt: 2 }, { ...sample, probedAt: 3 }], 3), { state: 'good' });
});

test('classifies threshold boundaries into the more severe band', () => {
  const round = { probedAt: 1, sent: 100, received: 100, medianLatencyMs: 100, p95LatencyMs: 100, jitterMs: 0, tcpState: 'up' as const };
  const quality = (change: Partial<typeof round>) => classifyVpsLineQuality([
    { ...round, ...change }, { ...round, probedAt: 2, ...change }, { ...round, probedAt: 3, ...change },
  ], 3).state;
  assert.equal(quality({ sent: 100, received: 99 }), 'degraded');
  assert.equal(quality({ sent: 100, received: 95 }), 'poor');
  assert.equal(quality({ jitterMs: 20 }), 'degraded');
  assert.equal(quality({ jitterMs: 50 }), 'poor');
  assert.equal(quality({ medianLatencyMs: 250 }), 'degraded');
  assert.equal(quality({ medianLatencyMs: 400 }), 'poor');
});

test('gives current TCP failures immediate poor quality and preserves ICMP/TCP diagnostics', () => {
  const base = { probedAt: 1, sent: 10, received: 10, medianLatencyMs: 100, p95LatencyMs: 100, jitterMs: 1, tcpState: 'up' as const };
  assert.deepEqual(classifyVpsLineQuality([{ ...base, tcpState: 'down' }], 1), { state: 'poor', diagnostic: 'tcp-failed' });
  assert.deepEqual(classifyVpsLineQuality([{ ...base, received: 0 }, { ...base, probedAt: 2, received: 0 }, { ...base, probedAt: 3, received: 0 }], 3), { state: 'ping-unavailable' });
});

test('uses the latest timestamp rather than input order for the TCP quality state', () => {
  const base = { sent: 10, received: 10, medianLatencyMs: 100, p95LatencyMs: 100, jitterMs: 1 };
  assert.deepEqual(classifyVpsLineQuality([
    { ...base, probedAt: 3, tcpState: 'up' },
    { ...base, probedAt: 1, tcpState: 'up' },
    { ...base, probedAt: 2, tcpState: 'down' },
  ], 3), { state: 'good' });
});

test('reduces a bucket deterministically and represents missing contributors as null', () => {
  const result = aggregateVpsBucket([
    { sent: 10, received: 10, medianLatencyMs: 100, p95LatencyMs: 120, jitterMs: 5, tcpState: 'up' as const },
    { sent: 10, received: 2, medianLatencyMs: 200, p95LatencyMs: 400, jitterMs: 20, tcpState: 'down' as const },
    { sent: 10, received: 0, medianLatencyMs: null, p95LatencyMs: null, jitterMs: null, tcpState: 'down' as const },
  ]);
  assert.deepEqual(result, { sent: 30, received: 12, lost: 18, lossPercent: 60, medianLatencyMs: 116.66666666666667, p95LatencyMs: 400, jitterMs: 6.5, tcpState: 'intermittent' });
  assert.deepEqual(aggregateVpsBucket([]), { sent: 0, received: 0, lost: 0, lossPercent: null, medianLatencyMs: null, p95LatencyMs: null, jitterMs: null, tcpState: 'unknown' });
  assert.equal(aggregateVpsBucket([{ sent: 1, received: 1, medianLatencyMs: 1, p95LatencyMs: 1, jitterMs: null, tcpState: 'up' }]).tcpState, 'up');
  assert.equal(aggregateVpsBucket([{ sent: 1, received: 0, medianLatencyMs: null, p95LatencyMs: null, jitterMs: null, tcpState: 'down' }]).tcpState, 'down');
});
