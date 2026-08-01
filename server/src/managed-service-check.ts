import type { ServiceHealthConfig } from './config.js';
import type { HttpProbeResult } from './health-check.js';

export type StableServiceStatus = 'running' | 'stopped' | 'error';

export interface ManagedServiceResult {
  id: string;
  status: StableServiceStatus;
  latencyMs: number;
  checkedAt: number;
}

interface ManagedServiceInput {
  id: string;
  health?: ServiceHealthConfig;
}

interface ManagedServiceDependencies {
  checkProcess: () => Promise<'running' | 'stopped' | null>;
  probeHealth: () => Promise<HttpProbeResult>;
  persist: (id: string, status: StableServiceStatus, latencyMs: number | null) => void;
  now: () => number;
}

export async function checkManagedLaunchAgent(
  service: ManagedServiceInput,
  dependencies: ManagedServiceDependencies,
): Promise<ManagedServiceResult> {
  const processStatus = await dependencies.checkProcess();
  if (processStatus !== 'running') {
    dependencies.persist(service.id, 'stopped', null);
    return { id: service.id, status: 'stopped', latencyMs: 0, checkedAt: dependencies.now() };
  }

  const probe = await dependencies.probeHealth();
  const requiresHealth = service.health !== undefined;
  const status: StableServiceStatus = requiresHealth && probe.status !== 'running' ? 'error' : 'running';
  const latencyMs = probe.status === 'running' || requiresHealth ? probe.latencyMs : 0;
  dependencies.persist(service.id, status, latencyMs || null);
  return { id: service.id, status, latencyMs, checkedAt: dependencies.now() };
}
