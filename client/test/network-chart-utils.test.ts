import assert from 'node:assert/strict';
import test from 'node:test';
import type { LatencySeries, VpsLineBucket } from '../src/types.js';
import {
  buildLatencyTooltipRows,
  buildVpsTooltip,
  clampTooltipCenterX,
  latencyBucketIndexAtX,
} from '../src/components/network-chart-utils.js';

const latencySeries: LatencySeries[] = [
  {
    id: 'domestic', label: '国内', color: '#3fb950', buckets: [
      { startAt: 0, endAt: 60_000, latencyMs: 0, hasData: true },
      { startAt: 60_000, endAt: 120_000, latencyMs: 28, hasData: true },
      { startAt: 120_000, endAt: 180_000, latencyMs: null, hasData: false },
    ],
  },
  {
    id: 'proxy', label: '国际', color: '#9b8cfa', buckets: [
      { startAt: 0, endAt: 60_000, latencyMs: 51, hasData: true },
      { startAt: 60_000, endAt: 120_000, latencyMs: null, hasData: true },
      { startAt: 120_000, endAt: 180_000, latencyMs: 80, hasData: true },
    ],
  },
  {
    id: 'third', label: '第三条', color: '#58a6ff', buckets: [
      { startAt: 0, endAt: 60_000, latencyMs: 19, hasData: true },
      { startAt: 60_000, endAt: 120_000, latencyMs: 20, hasData: true },
      { startAt: 120_000, endAt: 180_000, latencyMs: 21, hasData: true },
    ],
  },
  {
    id: 'fourth', label: '第四条', color: '#d29922', buckets: [
      { startAt: 0, endAt: 60_000, latencyMs: 70, hasData: true },
      { startAt: 60_000, endAt: 120_000, latencyMs: 71, hasData: true },
      { startAt: 120_000, endAt: 180_000, latencyMs: 72, hasData: true },
    ],
  },
];

test('maps x through chart content bounds to first, middle, and last shared bucket', () => {
  assert.equal(latencyBucketIndexAtX(40, 300, 40, 20, 3), 0);
  assert.equal(latencyBucketIndexAtX(160, 300, 40, 20, 3), 1);
  assert.equal(latencyBucketIndexAtX(280, 300, 40, 20, 3), 2);
});

test('clamps hover x outside the chart content bounds', () => {
  assert.equal(latencyBucketIndexAtX(-20, 300, 40, 20, 3), 0);
  assert.equal(latencyBucketIndexAtX(999, 300, 40, 20, 3), 2);
  assert.equal(latencyBucketIndexAtX(100, 0, 40, 20, 3), 0);
});

test('builds tooltip rows in configured order for all four latency series', () => {
  assert.deepEqual(buildLatencyTooltipRows(latencySeries, 0), [
    { id: 'domestic', label: '国内', color: '#3fb950', value: '0ms' },
    { id: 'proxy', label: '国际', color: '#9b8cfa', value: '51ms' },
    { id: 'third', label: '第三条', color: '#58a6ff', value: '19ms' },
    { id: 'fourth', label: '第四条', color: '#d29922', value: '70ms' },
  ]);
});

test('shows missing buckets and absent series buckets as 无数据', () => {
  const incomplete: LatencySeries[] = [
    ...latencySeries,
    { id: 'short', label: '短序列', color: '#d29922', buckets: [] },
  ];
  assert.deepEqual(buildLatencyTooltipRows(incomplete, 1).map(row => row.value), ['28ms', '无数据', '20ms', '71ms', '无数据']);
});

test('uses one VPS bucket index for latency and packet-loss hover layers', () => {
  const index = latencyBucketIndexAtX(160, 300, 40, 20, 3);
  assert.equal(index, 1);
  const vpsBuckets: VpsLineBucket[] = [
    { startAt: Date.UTC(2026, 7, 14, 0, 0), endAt: Date.UTC(2026, 7, 14, 0, 5), hasData: true, medianLatencyMs: 30, p95LatencyMs: 50, sent: 10, lost: 0, lossPercent: 0, jitterMs: 1, tcpState: 'up' },
    { startAt: Date.UTC(2026, 7, 14, 0, 5), endAt: Date.UTC(2026, 7, 14, 0, 10), hasData: true, medianLatencyMs: 0, p95LatencyMs: 42.5, sent: 10, lost: 1, lossPercent: 10, jitterMs: 2.5, tcpState: 'up' },
    { startAt: Date.UTC(2026, 7, 14, 0, 10), endAt: Date.UTC(2026, 7, 14, 0, 15), hasData: false, medianLatencyMs: null, p95LatencyMs: null, sent: null, lost: null, lossPercent: null, jitterMs: null, tcpState: 'unknown' },
  ];

  assert.deepEqual(buildVpsTooltip(vpsBuckets[index]), {
    interval: '08:05:00–08:10:00',
    medianLatency: '0ms',
    p95Latency: '42.5ms',
    lossPercent: '10%',
    lostSent: '1/10',
    jitter: '2.5ms',
    tcp: 'up',
  });

  assert.deepEqual(buildVpsTooltip(vpsBuckets[index + 1]), {
    interval: '08:10:00–08:15:00',
    message: '该时段无探测数据',
  });
});

test('formats VPS intervals in Asia/Shanghai regardless of process timezone', () => {
  const bucket: VpsLineBucket = {
    startAt: Date.UTC(2026, 7, 14, 0, 0),
    endAt: Date.UTC(2026, 7, 14, 0, 5),
    hasData: false, medianLatencyMs: null, p95LatencyMs: null, sent: null, lost: null,
    lossPercent: null, jitterMs: null, tcpState: 'unknown',
  };
  assert.deepEqual(buildVpsTooltip(bucket), {
    interval: '08:00:00–08:05:00',
    message: '该时段无探测数据',
  });
});

test('disambiguates VPS intervals that cross an Asia/Shanghai date boundary', () => {
  const bucket: VpsLineBucket = {
    startAt: Date.UTC(2026, 7, 14, 15, 59, 30),
    endAt: Date.UTC(2026, 7, 14, 16, 0, 45),
    hasData: false, medianLatencyMs: null, p95LatencyMs: null, sent: null, lost: null,
    lossPercent: null, jitterMs: null, tcpState: 'unknown',
  };
  assert.deepEqual(buildVpsTooltip(bucket), {
    interval: '08-14 23:59:30–08-15 00:00:45',
    message: '该时段无探测数据',
  });
});

test('clamps centered tooltip positions inside both card edges', () => {
  assert.equal(clampTooltipCenterX(5, 120, 400, 8), 68);
  assert.equal(clampTooltipCenterX(200, 120, 400, 8), 200);
  assert.equal(clampTooltipCenterX(395, 120, 400, 8), 332);
});
