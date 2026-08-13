import {
  NET_TARGETS,
  validateNetLatencySeries,
  type NetLatencyPath,
  type NetLatencySeries,
} from '../config.js';
import type { GroupStat, NetProbe } from '../db.js';

const BUCKET_COUNT = 48;

export type LatencyBucket = {
  startAt: number;
  endAt: number;
  latencyMs: number | null;
  hasData: boolean;
};

export type LatencySeriesResponse = Pick<NetLatencySeries, 'id' | 'label' | 'color'> & {
  buckets: LatencyBucket[];
};

export type LatencySeriesWarning = {
  code: 'NETWORK_LATENCY_SERIES_SKIPPED';
  seriesId: string | null;
  reason: string;
};

type BuildLatencySeriesOptions = {
  entries: readonly unknown[];
  sinceMs: number;
  nowMs: number;
  getGroupStats(group: string, sinceMs: number): GroupStat[];
  getNetProbes(path: string, sinceMs: number): NetProbe[];
  logWarning(warning: LatencySeriesWarning): void;
};

type TimedValue = {
  timestamp: number;
  latencyMs: number | null;
};

function createLatencyBuckets(values: readonly TimedValue[], sinceMs: number, nowMs: number): LatencyBucket[] {
  const bucketSize = (nowMs - sinceMs) / BUCKET_COUNT;
  return Array.from({ length: BUCKET_COUNT }, (_, index) => {
    const startAt = sinceMs + index * bucketSize;
    const endAt = startAt + bucketSize;
    const samples = values.filter(value => value.timestamp >= startAt && value.timestamp < endAt);
    const latencies = samples.flatMap(value => value.latencyMs !== null ? [value.latencyMs] : []);
    return {
      startAt,
      endAt,
      latencyMs: latencies.length
        ? Math.round(latencies.reduce((sum, latency) => sum + latency, 0) / latencies.length)
        : null,
      hasData: samples.length > 0,
    };
  });
}

function positiveLatency(value: number | null): number | null {
  return value !== null && Number.isFinite(value) && value > 0 ? value : null;
}

export function buildLatencySeries(options: BuildLatencySeriesOptions): LatencySeriesResponse[] {
  const validated = validateNetLatencySeries(options.entries);
  for (const warning of validated.warnings) {
    options.logWarning({
      code: 'NETWORK_LATENCY_SERIES_SKIPPED',
      seriesId: warning.id,
      reason: warning.reason,
    });
  }

  const groupCache = new Map<string, GroupStat[]>();
  const probeCache = new Map<NetLatencyPath, NetProbe[]>();
  const targetIdsByGroup = new Map([
    ['domestic', new Set(NET_TARGETS.filter(target => target.group === 'domestic').map(target => target.id))],
    ['international', new Set(NET_TARGETS.filter(target => target.group === 'international').map(target => target.id))],
  ] as const);
  const output: LatencySeriesResponse[] = [];

  for (const series of validated.series) {
    let values: TimedValue[];
    if (series.source.kind === 'group') {
      const source = series.source;
      const usesPreaggregatedStats = source.group === 'domestic' && source.path === 'direct'
        || source.group === 'international' && source.path === 'proxy';
      if (usesPreaggregatedStats) {
        let stats = groupCache.get(source.group);
        if (!stats) {
          stats = options.getGroupStats(source.group, options.sinceMs);
          groupCache.set(source.group, stats);
        }
        values = stats.map(stat => ({
          timestamp: stat.computed_at,
          latencyMs: positiveLatency(stat.avg_latency_ms),
        }));
      } else {
        let probes = probeCache.get(source.path);
        if (!probes) {
          probes = options.getNetProbes(source.path, options.sinceMs);
          probeCache.set(source.path, probes);
        }
        const targetIds = targetIdsByGroup.get(source.group)!;
        values = probes
          .filter(probe => targetIds.has(probe.dest_id))
          .map(probe => ({
            timestamp: probe.probed_at,
            latencyMs: probe.up === 1 ? positiveLatency(probe.latency_ms) : null,
          }));
      }
    } else {
      const targetId = series.source.targetId;
      let probes = probeCache.get(series.source.path);
      if (!probes) {
        probes = options.getNetProbes(series.source.path, options.sinceMs);
        probeCache.set(series.source.path, probes);
      }
      values = probes
        .filter(probe => probe.dest_id === targetId)
        .map(probe => ({
          timestamp: probe.probed_at,
          latencyMs: probe.up === 1 ? positiveLatency(probe.latency_ms) : null,
        }));
    }

    output.push({
      id: series.id,
      label: series.label,
      color: series.color,
      buckets: createLatencyBuckets(values, options.sinceMs, options.nowMs),
    });
  }

  return output;
}
