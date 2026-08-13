export type TcpBucketState = 'up' | 'intermittent' | 'down' | 'unknown';
export type TcpProbeState = Exclude<TcpBucketState, 'intermittent' | 'unknown'>;

export type VpsLineSampleMetrics = {
  probedAt: number;
  sent: number;
  received: number;
  medianLatencyMs: number | null;
  p95LatencyMs: number | null;
  jitterMs: number | null;
  tcpState: TcpProbeState;
};

type BucketSample = Omit<VpsLineSampleMetrics, 'probedAt'> & { tcpState: TcpBucketState };

export type VpsLineQualityState = 'good' | 'degraded' | 'poor' | 'collecting' | 'ping-unavailable' | 'unavailable';

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function calculateRoundMetrics(rtts: readonly number[]): { medianLatencyMs: number | null; p95LatencyMs: number | null; jitterMs: number | null } {
  const valid = rtts.filter(value => Number.isFinite(value) && value >= 0);
  if (!valid.length) return { medianLatencyMs: null, p95LatencyMs: null, jitterMs: null };
  const sorted = [...valid].sort((left, right) => left - right);
  const p95LatencyMs = sorted[Math.ceil(sorted.length * 0.95) - 1];
  const jitterMs = valid.length < 2 ? null : valid.slice(1).reduce((sum, value, index) => sum + Math.abs(value - valid[index]), 0) / (valid.length - 1);
  return { medianLatencyMs: median(valid), p95LatencyMs, jitterMs };
}

export function aggregateVpsBucket(samples: readonly BucketSample[]) {
  const sent = samples.reduce((sum, sample) => sum + sample.sent, 0);
  const received = samples.reduce((sum, sample) => sum + sample.received, 0);
  const latencyContributors = samples.filter((sample): sample is BucketSample & { medianLatencyMs: number } => sample.received > 0 && sample.medianLatencyMs !== null);
  const jitterContributors = samples.filter((sample): sample is BucketSample & { jitterMs: number } => sample.jitterMs !== null && sample.received > 1);
  const states = samples.map(sample => sample.tcpState).filter((state): state is TcpProbeState => state === 'up' || state === 'down');
  const tcpState: TcpBucketState = !states.length ? 'unknown' : states.every(state => state === 'up') ? 'up' : states.every(state => state === 'down') ? 'down' : 'intermittent';
  const latencyWeight = latencyContributors.reduce((sum, sample) => sum + sample.received, 0);
  const jitterWeight = jitterContributors.reduce((sum, sample) => sum + sample.received - 1, 0);
  const p95s = samples.flatMap(sample => sample.p95LatencyMs === null ? [] : [sample.p95LatencyMs]);
  return {
    sent,
    received,
    lost: sent - received,
    lossPercent: sent ? ((sent - received) / sent) * 100 : null,
    medianLatencyMs: latencyWeight ? latencyContributors.reduce((sum, sample) => sum + sample.medianLatencyMs * sample.received, 0) / latencyWeight : null,
    p95LatencyMs: p95s.length ? Math.max(...p95s) : null,
    jitterMs: jitterWeight ? jitterContributors.reduce((sum, sample) => sum + sample.jitterMs * (sample.received - 1), 0) / jitterWeight : null,
    tcpState,
  };
}

export function classifyVpsLineQuality(samples: readonly VpsLineSampleMetrics[], now: number): { state: VpsLineQualityState; diagnostic?: 'tcp-failed' } {
  const window = samples
    .filter(sample => sample.probedAt >= now - 5 * 60_000 && sample.probedAt <= now)
    .sort((left, right) => left.probedAt - right.probedAt);
  const latest = window.at(-1);
  if (!latest) return { state: 'unavailable' };
  if (latest.tcpState === 'down') return { state: 'poor', diagnostic: 'tcp-failed' };
  if (window.length < 3) return { state: 'collecting' };
  const sent = window.reduce((sum, sample) => sum + sample.sent, 0);
  const received = window.reduce((sum, sample) => sum + sample.received, 0);
  if (!received) return { state: 'ping-unavailable' };
  const medianLatencyMs = median(window.flatMap(sample => sample.medianLatencyMs === null ? [] : [sample.medianLatencyMs]));
  const jitters = window.flatMap(sample => sample.jitterMs === null ? [] : [sample.jitterMs]);
  if (!sent || medianLatencyMs === null) return { state: 'unavailable' };
  const lossPercent = ((sent - received) / sent) * 100;
  const jitterMs = jitters.length ? jitters.reduce((sum, jitter) => sum + jitter, 0) / jitters.length : null;
  if (lossPercent >= 5 || (jitterMs !== null && jitterMs >= 50) || medianLatencyMs >= 400) return { state: 'poor' };
  if (lossPercent >= 1 || (jitterMs !== null && jitterMs >= 20) || medianLatencyMs >= 250) return { state: 'degraded' };
  return { state: 'good' };
}
