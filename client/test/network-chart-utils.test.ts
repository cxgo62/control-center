import assert from 'node:assert/strict';
import test from 'node:test';
import type { LatencySeries, VpsLineBucket } from '../src/types.js';
import {
  averageLatencyForSeries,
  buildLatencyTooltipRows,
  buildVpsTooltip,
  clampTooltipCenterX,
  latencyChartMaximum,
  latencyBucketIndexAtX,
  isolatedLatencyPoints,
  latencyPath,
  moveBucketSelection,
  packetLossColor,
  shouldCommitRangeResponse,
  shouldCommitLatestRequest,
  vpsTooltipAccessibleText,
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

test('treats hasData false as missing even if a stale numeric value is present', () => {
  const stale: LatencySeries[] = [{
    id: 'stale', label: '旧值', color: '#fff',
    buckets: [{ startAt: 0, endAt: 1, latencyMs: 0, hasData: false }],
  }];
  assert.equal(buildLatencyTooltipRows(stale, 0)[0].value, '无数据');
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

test('resolves latency averages by series id, including valid zero values', () => {
  assert.equal(averageLatencyForSeries(latencySeries, 'domestic'), 14);
  assert.equal(averageLatencyForSeries(latencySeries, 'proxy'), 65.5);
  assert.equal(averageLatencyForSeries(latencySeries, 'missing'), null);
});

test('builds generic chart paths with gaps for missing buckets while rendering zero', () => {
  assert.equal(
    latencyPath(latencySeries[0].buckets, index => index * 10, value => 100 - value),
    'M0.0 100.0 L10.0 72.0',
  );
  const explicitGap: LatencySeries = {
    id: 'gap', label: 'Gap', color: '#fff', buckets: [
      { startAt: 0, endAt: 1, latencyMs: 10, hasData: true },
      { startAt: 1, endAt: 2, latencyMs: 0, hasData: false },
      { startAt: 2, endAt: 3, latencyMs: 20, hasData: true },
    ],
  };
  assert.equal(latencyPath(explicitGap.buckets, index => index * 10, value => 100 - value), 'M0.0 90.0 M20.0 80.0');
});

test('returns visible markers for isolated 5-minute samples in 75-second buckets', () => {
  const buckets = Array.from({ length: 9 }, (_, index) => ({
    startAt: index * 75_000,
    endAt: (index + 1) * 75_000,
    latencyMs: index % 4 === 0 ? 20 + index : null,
    hasData: index % 4 === 0,
  }));

  assert.deepEqual(
    isolatedLatencyPoints(buckets, index => index * 10, value => 100 - value),
    [
      { index: 0, x: 0, y: 80 },
      { index: 4, x: 40, y: 76 },
      { index: 8, x: 80, y: 72 },
    ],
  );
  assert.equal(latencyPath(buckets, index => index * 10, value => 100 - value), 'M0.0 80.0 M40.0 76.0 M80.0 72.0');
});

test('does not duplicate markers for samples already painted by a connected run', () => {
  assert.deepEqual(
    isolatedLatencyPoints(latencySeries[0].buckets, index => index * 10, value => 100 - value),
    [],
  );
});

test('moves a shared bucket selection with bounded keyboard navigation', () => {
  assert.equal(moveBucketSelection(null, -1, 4), 3);
  assert.equal(moveBucketSelection(null, 1, 4), 0);
  assert.equal(moveBucketSelection(2, -1, 4), 1);
  assert.equal(moveBucketSelection(2, 1, 4), 3);
  assert.equal(moveBucketSelection(3, 1, 4), 3);
  assert.equal(moveBucketSelection(0, -1, 4), 0);
  assert.equal(moveBucketSelection(null, 1, 0), null);
});

test('exposes VPS P95 and lost/sent details as assistive text', () => {
  const tooltip = buildVpsTooltip({
    startAt: Date.UTC(2026, 7, 14, 0, 5), endAt: Date.UTC(2026, 7, 14, 0, 10),
    hasData: true, medianLatencyMs: 30, p95LatencyMs: 52, sent: 10, lost: 2,
    lossPercent: 20, jitterMs: 3, tcpState: 'up',
  });
  assert.match(vpsTooltipAccessibleText(tooltip), /P95 延迟 52ms/);
  assert.match(vpsTooltipAccessibleText(tooltip), /丢失 \/ 发送 2\/10/);
});

test('scales across every finite non-null latency and safely handles empty data', () => {
  assert.equal(latencyChartMaximum(latencySeries), 100);
  assert.equal(latencyChartMaximum([]), 40);
});

test('maps packet loss thresholds and missing samples to exact band colors', () => {
  assert.equal(packetLossColor(null), 'rgba(255,255,255,.10)');
  assert.equal(packetLossColor(0), '#3fb950');
  assert.equal(packetLossColor(1), '#d9a531');
  assert.equal(packetLossColor(4.99), '#d9a531');
  assert.equal(packetLossColor(5), '#f15a4a');
});

test('commits only the latest response for the currently selected range', () => {
  assert.equal(shouldCommitRangeResponse('1h', '1h', 4, 4), true);
  assert.equal(shouldCommitRangeResponse('7d', '1h', 4, 4), false);
  assert.equal(shouldCommitRangeResponse('1h', '1h', 3, 4), false);
});

test('commits only the latest active polling request', () => {
  assert.equal(shouldCommitLatestRequest(5, 5, true), true);
  assert.equal(shouldCommitLatestRequest(4, 5, true), false);
  assert.equal(shouldCommitLatestRequest(5, 5, false), false);
});
