interface ProbeTimestamp {
  probed_at: number;
}

export function latestProbedAt(probes: readonly ProbeTimestamp[], fallback: number): number {
  let latest = fallback;
  for (const probe of probes) {
    if (probe.probed_at > latest) latest = probe.probed_at;
  }
  return latest;
}
