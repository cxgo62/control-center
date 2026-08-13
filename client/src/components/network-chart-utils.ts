import type { LatencyBucket, LatencySeries, VpsLineBucket } from '../types.js';

export type LatencyTooltipRow = {
  id: string;
  label: string;
  color: string;
  value: string;
};

export type IsolatedLatencyPoint = {
  index: number;
  x: number;
  y: number;
};

export type VpsTooltipViewModel =
  | { interval: string; message: '该时段无探测数据' }
  | {
      interval: string;
      medianLatency: string;
      p95Latency: string;
      lossPercent: string;
      lostSent: string;
      jitter: string;
      tcp: VpsLineBucket['tcpState'];
    };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

function formatMilliseconds(value: number | null): string {
  return value !== null && Number.isFinite(value) ? `${formatNumber(value)}ms` : '无数据';
}

type ShanghaiDateTime = {
  monthDay: string;
  time: string;
};

function shanghaiDateTime(value: Date): ShanghaiDateTime {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = new Map(formatter.formatToParts(value).map(part => [part.type, part.value]));
  return {
    monthDay: `${parts.get('month')}-${parts.get('day')}`,
    time: `${parts.get('hour')}:${parts.get('minute')}:${parts.get('second')}`,
  };
}

export function formatBucketInterval(startAt: number, endAt: number): string {
  const start = new Date(startAt);
  const end = new Date(endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '无效时间';
  const startDateTime = shanghaiDateTime(start);
  const endDateTime = shanghaiDateTime(end);
  return startDateTime.monthDay === endDateTime.monthDay
    ? `${startDateTime.time}–${endDateTime.time}`
    : `${startDateTime.monthDay} ${startDateTime.time}–${endDateTime.monthDay} ${endDateTime.time}`;
}

/** Maps a pointer x coordinate to the common bucket index within a chart's drawable content. */
export function latencyBucketIndexAtX(
  hoverX: number,
  chartWidth: number,
  leftPadding: number,
  rightPadding: number,
  bucketCount: number,
): number {
  if (!Number.isFinite(chartWidth) || chartWidth <= 0 || bucketCount <= 0) return 0;
  const contentStart = Math.max(0, leftPadding);
  const contentEnd = Math.max(contentStart, chartWidth - Math.max(0, rightPadding));
  const contentWidth = contentEnd - contentStart;
  if (contentWidth <= 0) return 0;
  const x = clamp(hoverX, contentStart, contentEnd);
  return clamp(Math.floor((x - contentStart) / contentWidth * bucketCount), 0, bucketCount - 1);
}

/** Produces one tooltip row per configured series, retaining server order and colors. */
export function buildLatencyTooltipRows(series: readonly LatencySeries[], bucketIndex: number): LatencyTooltipRow[] {
  return series.map(item => {
    const bucket = item.buckets[bucketIndex];
    return {
      id: item.id,
      label: item.label,
      color: item.color,
      value: formatMilliseconds(bucket?.hasData ? bucket.latencyMs : null),
    };
  });
}

/** Resolves a status metric by stable series id; valid zero-latency samples participate. */
export function averageLatencyForSeries(series: readonly LatencySeries[], seriesId: string): number | null {
  const item = series.find(candidate => candidate.id === seriesId);
  if (!item) return null;
  const values = item.buckets
    .filter(bucket => bucket.hasData && bucket.latencyMs !== null && Number.isFinite(bucket.latencyMs))
    .map(bucket => bucket.latencyMs as number);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

/** Returns a stable rounded chart ceiling across an arbitrary set of configured series. */
export function latencyChartMaximum(series: readonly LatencySeries[]): number {
  const values = series.flatMap(item => item.buckets
    .filter(bucket => bucket.hasData && bucket.latencyMs !== null && Number.isFinite(bucket.latencyMs))
    .map(bucket => bucket.latencyMs as number));
  const maximum = values.length ? Math.max(...values) : 0;
  return Math.max(40, Math.ceil((maximum * 1.2) / 20) * 20);
}

/** Builds one SVG path, restarting after explicit missing buckets and retaining 0 ms samples. */
export function latencyPath(
  buckets: readonly LatencyBucket[],
  xForIndex: (index: number) => number,
  yForValue: (value: number) => number,
): string {
  let path = '';
  let penDown = false;
  buckets.forEach((bucket, index) => {
    const value = bucket.latencyMs;
    if (!bucket.hasData || value === null || !Number.isFinite(value)) {
      penDown = false;
      return;
    }
    path += `${penDown ? ' L' : path ? ' M' : 'M'}${xForIndex(index).toFixed(1)} ${yForValue(value).toFixed(1)}`;
    penDown = true;
  });
  return path;
}

function hasFiniteLatency(bucket: LatencyBucket | undefined): bucket is LatencyBucket & { latencyMs: number } {
  return Boolean(bucket?.hasData && bucket.latencyMs !== null && Number.isFinite(bucket.latencyMs));
}

/** Returns samples whose one-point run cannot be painted by an SVG stroke path. */
export function isolatedLatencyPoints(
  buckets: readonly LatencyBucket[],
  xForIndex: (index: number) => number,
  yForValue: (value: number) => number,
): IsolatedLatencyPoint[] {
  return buckets.flatMap((bucket, index) => {
    if (!hasFiniteLatency(bucket) || hasFiniteLatency(buckets[index - 1]) || hasFiniteLatency(buckets[index + 1])) return [];
    return [{ index, x: xForIndex(index), y: yForValue(bucket.latencyMs) }];
  });
}

/** Moves a chart's shared bucket cursor without wrapping beyond either edge. */
export function moveBucketSelection(currentIndex: number | null, delta: -1 | 1, bucketCount: number): number | null {
  if (bucketCount <= 0) return null;
  if (currentIndex === null) return delta < 0 ? bucketCount - 1 : 0;
  return clamp(currentIndex + delta, 0, bucketCount - 1);
}

export function packetLossColor(lossPercent: number | null): string {
  if (lossPercent === null || !Number.isFinite(lossPercent)) return 'rgba(255,255,255,.10)';
  if (lossPercent < 1) return '#3fb950';
  if (lossPercent < 5) return '#d9a531';
  return '#f15a4a';
}

export function shouldCommitRangeResponse(
  requestedRange: string,
  currentRange: string,
  requestId: number,
  latestRequestId: number,
): boolean {
  return requestedRange === currentRange && shouldCommitLatestRequest(requestId, latestRequestId);
}

export function shouldCommitLatestRequest(
  requestId: number,
  latestRequestId: number,
  active = true,
): boolean {
  return active && requestId === latestRequestId;
}

/** Builds the shared latency/loss tooltip content for one VPS bucket. */
export function buildVpsTooltip(bucket: VpsLineBucket): VpsTooltipViewModel {
  const interval = formatBucketInterval(bucket.startAt, bucket.endAt);
  if (!bucket.hasData) return { interval, message: '该时段无探测数据' };
  return {
    interval,
    medianLatency: formatMilliseconds(bucket.medianLatencyMs),
    p95Latency: formatMilliseconds(bucket.p95LatencyMs),
    lossPercent: bucket.lossPercent !== null && Number.isFinite(bucket.lossPercent) ? `${formatNumber(bucket.lossPercent)}%` : '无数据',
    lostSent: bucket.lost !== null && bucket.sent !== null ? `${bucket.lost}/${bucket.sent}` : '无数据',
    jitter: formatMilliseconds(bucket.jitterMs),
    tcp: bucket.tcpState,
  };
}

export function vpsTooltipAccessibleText(tooltip: VpsTooltipViewModel): string {
  if ('message' in tooltip) return `${tooltip.interval}，${tooltip.message}`;
  return [
    tooltip.interval,
    `中位延迟 ${tooltip.medianLatency}`,
    `P95 延迟 ${tooltip.p95Latency}`,
    `丢包率 ${tooltip.lossPercent}`,
    `丢失 / 发送 ${tooltip.lostSent}`,
    `抖动 ${tooltip.jitter}`,
    `TCP ${tooltip.tcp}`,
  ].join('，');
}

/** Keeps a centered tooltip fully inside its card, including a small card-edge gutter. */
export function clampTooltipCenterX(pointerX: number, tooltipWidth: number, cardWidth: number, gutter = 8): number {
  const halfTooltip = Math.max(0, tooltipWidth) / 2;
  const minimum = Math.max(0, gutter) + halfTooltip;
  const maximum = Math.max(0, cardWidth) - Math.max(0, gutter) - halfTooltip;
  if (minimum > maximum) return Math.max(0, cardWidth) / 2;
  return clamp(pointerX, minimum, maximum);
}
