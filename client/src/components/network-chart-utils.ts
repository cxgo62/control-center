import type { LatencySeries, VpsLineBucket } from '../types.js';

export type LatencyTooltipRow = {
  id: string;
  label: string;
  color: string;
  value: string;
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

function formatInterval(startAt: number, endAt: number): string {
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
  return series.map(item => ({
    id: item.id,
    label: item.label,
    color: item.color,
    value: formatMilliseconds(item.buckets[bucketIndex]?.latencyMs ?? null),
  }));
}

/** Builds the shared latency/loss tooltip content for one VPS bucket. */
export function buildVpsTooltip(bucket: VpsLineBucket): VpsTooltipViewModel {
  const interval = formatInterval(bucket.startAt, bucket.endAt);
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

/** Keeps a centered tooltip fully inside its card, including a small card-edge gutter. */
export function clampTooltipCenterX(pointerX: number, tooltipWidth: number, cardWidth: number, gutter = 8): number {
  const halfTooltip = Math.max(0, tooltipWidth) / 2;
  const minimum = Math.max(0, gutter) + halfTooltip;
  const maximum = Math.max(0, cardWidth) - Math.max(0, gutter) - halfTooltip;
  if (minimum > maximum) return Math.max(0, cardWidth) / 2;
  return clamp(pointerX, minimum, maximum);
}
