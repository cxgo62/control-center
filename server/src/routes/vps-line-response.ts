import type { VpsLineSampleRow } from '../db.js';
import type { VpsLineDiscoveryState } from '../vps-line/monitor.js';
import {
  aggregateVpsBucket,
  classifyVpsLineQuality,
  type TcpBucketState,
  type VpsLineQualityState,
} from '../vps-line/metrics.js';

const BUCKET_COUNT = 48;
const DISPLAY_LABEL = '搬瓦工私人线路';

export type NetworkRange = '1h' | '6h' | '24h' | '7d';

const RANGE_DURATION_MS: Record<NetworkRange, number> = {
  '1h': 60 * 60_000,
  '6h': 6 * 60 * 60_000,
  '24h': 24 * 60 * 60_000,
  '7d': 7 * 24 * 60 * 60_000,
};

export function resolveNetworkRange(value: string | undefined, nowMs: number): {
  range: NetworkRange;
  sinceMs: number;
} {
  const range: NetworkRange = value === '6h' || value === '24h' || value === '7d' ? value : '1h';
  return { range, sinceMs: nowMs - RANGE_DURATION_MS[range] };
}

type VpsLineBucket = {
  startAt: number;
  endAt: number;
  hasData: boolean;
  medianLatencyMs: number | null;
  p95LatencyMs: number | null;
  sent: number | null;
  lost: number | null;
  lossPercent: number | null;
  jitterMs: number | null;
  tcpState: TcpBucketState;
};

function createBuckets(samples: readonly VpsLineSampleRow[], sinceMs: number, nowMs: number): VpsLineBucket[] {
  const bucketSize = (nowMs - sinceMs) / BUCKET_COUNT;
  return Array.from({ length: BUCKET_COUNT }, (_, index) => {
    const startAt = sinceMs + index * bucketSize;
    const endAt = startAt + bucketSize;
    const bucketSamples = samples.filter(sample =>
      sample.probedAt >= startAt
      && (sample.probedAt < endAt || index === BUCKET_COUNT - 1 && sample.probedAt <= nowMs)
    );
    if (!bucketSamples.length) {
      return {
        startAt,
        endAt,
        hasData: false,
        medianLatencyMs: null,
        p95LatencyMs: null,
        sent: null,
        lost: null,
        lossPercent: null,
        jitterMs: null,
        tcpState: 'unknown',
      };
    }
    const aggregate = aggregateVpsBucket(bucketSamples);
    return {
      startAt,
      endAt,
      hasData: true,
      medianLatencyMs: aggregate.medianLatencyMs,
      p95LatencyMs: aggregate.p95LatencyMs,
      sent: aggregate.sent,
      lost: aggregate.lost,
      lossPercent: aggregate.lossPercent,
      jitterMs: aggregate.jitterMs,
      tcpState: aggregate.tcpState,
    };
  });
}

function qualityLabel(
  state: VpsLineQualityState,
  latest: VpsLineSampleRow | undefined,
  diagnostic: 'tcp-failed' | undefined,
): string {
  if (state === 'good') return '质量良好';
  if (state === 'degraded') return '有波动';
  if (state === 'collecting') return '正在积累线路样本';
  if (state === 'ping-unavailable') return 'Ping 不可用 · 代理端口正常';
  if (state === 'poor' && diagnostic === 'tcp-failed' && latest && latest.received > 0) {
    return '主机在线 · 代理端口异常';
  }
  if (state === 'poor') return '质量较差';
  return '数据不可用';
}

export function buildVpsLineResponse(
  discoveryState: VpsLineDiscoveryState,
  samples: readonly VpsLineSampleRow[],
  sinceMs: number,
  nowMs: number,
) {
  if (discoveryState.status === 'unconfigured') {
    return { status: 'unconfigured' as const, displayLabel: DISPLAY_LABEL, message: '私人节点未配置' };
  }
  if (discoveryState.status === 'unresolved') {
    return { status: 'unresolved' as const, displayLabel: DISPLAY_LABEL, message: '无法识别私人节点' };
  }

  const selectedSamples = samples
    .filter(sample => sample.probedAt >= sinceMs && sample.probedAt <= nowMs)
    .sort((left, right) => left.probedAt - right.probedAt);
  const latest = selectedSamples.at(-1);
  const quality = classifyVpsLineQuality(selectedSamples, nowMs);
  const rangeAggregate = aggregateVpsBucket(selectedSamples);
  const latestAggregate = latest ? aggregateVpsBucket([latest]) : null;

  return {
    status: quality.state === 'collecting' || !latest ? 'accumulating' as const : 'available' as const,
    displayLabel: DISPLAY_LABEL,
    quality: {
      state: latest ? quality.state : 'collecting' as const,
      label: latest ? qualityLabel(quality.state, latest, quality.diagnostic) : qualityLabel('collecting', undefined, undefined),
      ...(quality.diagnostic ? { diagnostic: quality.diagnostic } : {}),
    },
    current: latest ? {
      hasData: true,
      medianLatencyMs: latest.medianLatencyMs,
      p95LatencyMs: latest.p95LatencyMs,
      jitterMs: latest.jitterMs,
      tcpState: latest.tcpState,
      icmpUsable: latest.icmpUsable,
      probedAt: latest.probedAt,
      sent: latestAggregate!.sent,
      lost: latestAggregate!.lost,
      lossPercent: latestAggregate!.lossPercent,
    } : {
      hasData: false,
      medianLatencyMs: null,
      p95LatencyMs: null,
      jitterMs: null,
      tcpState: 'unknown' as const,
      icmpUsable: null,
      probedAt: null,
      sent: null,
      lost: null,
      lossPercent: null,
    },
    rangeSummary: selectedSamples.length ? {
      hasData: true,
      sent: rangeAggregate.sent,
      lost: rangeAggregate.lost,
      lossPercent: rangeAggregate.lossPercent,
    } : {
      hasData: false,
      sent: null,
      lost: null,
      lossPercent: null,
    },
    buckets: createBuckets(selectedSamples, sinceMs, nowMs),
  };
}

export const unavailableVpsLineResponse = {
  status: 'error' as const,
  displayLabel: DISPLAY_LABEL,
  error: {
    code: 'VPS_LINE_DATA_UNAVAILABLE' as const,
    message: '线路数据暂时不可用',
  },
};
