interface ProbeTimestamp {
  probed_at: number;
}

interface TargetProbe extends ProbeTimestamp {
  dest_id: string;
}

interface LivePingResult {
  up: boolean;
  latencyMs: number;
}

export function latestProbedAt(probes: readonly ProbeTimestamp[], fallback: number): number {
  let latest = fallback;
  for (const probe of probes) {
    if (probe.probed_at > latest) latest = probe.probed_at;
  }
  return latest;
}

export function latestProbeForTarget<T extends TargetProbe>(probes: readonly T[], destId: string): T | null {
  let latest: T | null = null;
  for (const probe of probes) {
    if (probe.dest_id === destId && (!latest || probe.probed_at > latest.probed_at)) latest = probe;
  }
  return latest;
}

export function createLivePingEntry(
  id: string,
  path: string,
  group: string,
  result: LivePingResult,
  probedAt: number,
) {
  return { id, path, group, ...result, probedAt };
}
