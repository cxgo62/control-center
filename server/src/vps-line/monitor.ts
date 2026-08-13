import { promises as fsPromises, watch as fsWatch } from 'node:fs';
import { insertVpsLineSample, type VpsLineSampleInput } from '../db.js';
import {
  resolvePrivateNode,
  type PrivateNodeEndpoint,
  type PrivateNodeResolutionErrorCode,
} from './node-resolver.js';
import { runProbeRound, type VpsLineProbeSample } from './probe-runner.js';

const PROBE_INTERVAL_MS = 60_000;
const DISCOVERY_INTERVAL_MS = 30 * 60_000;
const FILE_CHANGE_DEBOUNCE_MS = 2_000;
const EARLY_REDISCOVERY_FAILURES = 3;
const DEFAULT_EARLY_REDISCOVERY_COOLDOWN_MS = 5 * 60_000;

export type VpsLineDiscoveryState =
  | { status: 'unconfigured' }
  | { status: 'resolved'; nodeName: string }
  | {
      status: 'unresolved';
      nodeName: string;
      code: PrivateNodeResolutionErrorCode | 'CLASH_CONFIG_UNAVAILABLE';
    };

export interface VpsLineMonitorLogger {
  info(context: Record<string, unknown>, message: string): void;
  warn(context: Record<string, unknown>, message: string): void;
  error(context: Record<string, unknown>, message: string): void;
}

export interface VpsLineMonitor {
  start(): Promise<void>;
  probeNow(): Promise<void>;
  getDiscoveryState(): VpsLineDiscoveryState;
  stop(): void;
}

type Watcher = {
  close(): void;
  on?(event: 'error', listener: (error: unknown) => void): unknown;
  off?(event: 'error', listener: (error: unknown) => void): unknown;
};
type DiscoveryReason = 'startup' | 'file_change' | 'fallback' | 'probe_failures';
type ProbeFailureCategory =
  | 'tcp_down'
  | 'icmp_no_replies'
  | 'tcp_down_and_icmp_no_replies'
  | 'probe_execution';

export type VpsLineMonitorDependencies = {
  configuredNodeName: string;
  configPath: string;
  logger: VpsLineMonitorLogger;
  readConfig?: (filePath: string) => Promise<string>;
  watchConfig?: (filePath: string, listener: () => void) => Watcher;
  resolveNode?: typeof resolvePrivateNode;
  runProbe?: (endpoint: PrivateNodeEndpoint) => Promise<VpsLineProbeSample>;
  insertSample?: (sample: VpsLineSampleInput) => void;
  now?: () => number;
  setInterval?: (callback: () => void, delayMs: number) => unknown;
  clearInterval?: (handle: unknown) => void;
  setTimeout?: (callback: () => void, delayMs: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  earlyRediscoveryCooldownMs?: number;
};

function defaultWatchConfig(filePath: string, listener: () => void): Watcher {
  return fsWatch(filePath, listener);
}

function failureCategory(sample: VpsLineProbeSample): ProbeFailureCategory | null {
  const tcpDown = sample.tcpState === 'down';
  const noIcmpReplies = sample.received === 0;
  if (tcpDown && noIcmpReplies) return 'tcp_down_and_icmp_no_replies';
  if (tcpDown) return 'tcp_down';
  if (noIcmpReplies) return 'icmp_no_replies';
  return null;
}

export function createVpsLineMonitor(dependencies: VpsLineMonitorDependencies): VpsLineMonitor {
  const configuredNodeName = dependencies.configuredNodeName.trim();
  const logger = dependencies.logger;
  const readConfig = dependencies.readConfig ?? (filePath => fsPromises.readFile(filePath, 'utf8'));
  const watchConfig = dependencies.watchConfig ?? defaultWatchConfig;
  const resolveNode = dependencies.resolveNode ?? resolvePrivateNode;
  const runProbe = dependencies.runProbe ?? (endpoint => runProbeRound(endpoint));
  const insertSample = dependencies.insertSample ?? insertVpsLineSample;
  const now = dependencies.now ?? Date.now;
  const scheduleInterval = dependencies.setInterval ?? ((callback, delayMs) => setInterval(callback, delayMs));
  const cancelInterval = dependencies.clearInterval ?? (handle => clearInterval(handle as ReturnType<typeof setInterval>));
  const scheduleTimeout = dependencies.setTimeout ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  const cancelTimeout = dependencies.clearTimeout ?? (handle => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const earlyRediscoveryCooldownMs = dependencies.earlyRediscoveryCooldownMs
    ?? DEFAULT_EARLY_REDISCOVERY_COOLDOWN_MS;

  let lifecycle: 'idle' | 'running' | 'stopped' = 'idle';
  let discoveryState: VpsLineDiscoveryState = { status: 'unconfigured' };
  let endpoint: PrivateNodeEndpoint | undefined;
  let watcher: Watcher | undefined;
  let probeInterval: unknown;
  let discoveryInterval: unknown;
  let debounceTimer: unknown;
  let discoveryPromise: Promise<void> | undefined;
  let queuedDiscoveryReason: DiscoveryReason | undefined;
  let probePromise: Promise<void> | undefined;
  let consecutiveFailures = 0;
  let lastEarlyRediscoveryAt = Number.NEGATIVE_INFINITY;
  let endpointGeneration = 0;

  const updateEndpoint = (nextEndpoint: PrivateNodeEndpoint | undefined): void => {
    const unchanged = endpoint === undefined && nextEndpoint === undefined
      || endpoint !== undefined
        && nextEndpoint !== undefined
        && endpoint.name === nextEndpoint.name
        && endpoint.host === nextEndpoint.host
        && endpoint.port === nextEndpoint.port;
    if (!unchanged) endpointGeneration += 1;
    endpoint = nextEndpoint;
  };

  const handleWatcherError = (): void => {
    if (lifecycle !== 'running') return;
    logger.warn({
      code: 'VPS_LINE_CONFIG_WATCH_FAILED',
      nodeName: configuredNodeName,
      category: 'watch_error',
    }, 'VPS line config watch unavailable');
  };

  const performDiscovery = async (reason: DiscoveryReason): Promise<void> => {
    let content: string;
    try {
      content = await readConfig(dependencies.configPath);
    } catch {
      if (lifecycle !== 'running') return;
      updateEndpoint(undefined);
      discoveryState = {
        status: 'unresolved',
        nodeName: configuredNodeName,
        code: 'CLASH_CONFIG_UNAVAILABLE',
      };
      logger.warn({
        code: 'VPS_LINE_DISCOVERY_FAILED',
        nodeName: configuredNodeName,
        category: 'CLASH_CONFIG_UNAVAILABLE',
        reason,
      }, 'VPS line node discovery failed');
      return;
    }

    if (lifecycle !== 'running') return;
    const result = resolveNode(content, configuredNodeName);
    if (!result.ok) {
      updateEndpoint(undefined);
      discoveryState = {
        status: 'unresolved',
        nodeName: configuredNodeName,
        code: result.error.code,
      };
      logger.warn({
        code: 'VPS_LINE_DISCOVERY_FAILED',
        nodeName: configuredNodeName,
        category: result.error.code,
        reason,
      }, 'VPS line node discovery failed');
      return;
    }

    updateEndpoint(result.endpoint);
    discoveryState = { status: 'resolved', nodeName: configuredNodeName };
    logger.info({
      code: 'VPS_LINE_DISCOVERY_RESOLVED',
      nodeName: configuredNodeName,
      reason,
    }, 'VPS line node discovery completed');
  };

  const discover = (reason: DiscoveryReason): Promise<void> => {
    if (lifecycle !== 'running') return Promise.resolve();
    if (discoveryPromise) {
      queuedDiscoveryReason = reason;
      return discoveryPromise;
    }

    const task = (async () => {
      let nextReason: DiscoveryReason | undefined = reason;
      while (nextReason && lifecycle === 'running') {
        await performDiscovery(nextReason);
        if (lifecycle !== 'running') return;
        nextReason = queuedDiscoveryReason;
        queuedDiscoveryReason = undefined;
      }
    })();

    const wrappedTask = task.finally(() => {
      if (discoveryPromise === wrappedTask) discoveryPromise = undefined;
    });
    discoveryPromise = wrappedTask;
    return wrappedTask;
  };

  const maybeRediscoverAfterFailure = async (): Promise<void> => {
    if (consecutiveFailures < EARLY_REDISCOVERY_FAILURES) return;
    const currentTime = now();
    if (currentTime - lastEarlyRediscoveryAt < earlyRediscoveryCooldownMs) return;
    lastEarlyRediscoveryAt = currentTime;
    logger.info({
      code: 'VPS_LINE_EARLY_REDISCOVERY',
      nodeName: configuredNodeName,
      consecutiveFailures,
    }, 'VPS line probe failures triggered rediscovery');
    await discover('probe_failures');
  };

  const recordProbeFailure = async (category: ProbeFailureCategory): Promise<void> => {
    consecutiveFailures += 1;
    logger.warn({
      code: category === 'probe_execution' ? 'VPS_LINE_PROBE_ERROR' : 'VPS_LINE_PROBE_FAILED',
      nodeName: configuredNodeName,
      category,
      consecutiveFailures,
    }, category === 'probe_execution' ? 'VPS line probe execution failed' : 'VPS line probe round failed');
    await maybeRediscoverAfterFailure();
  };

  const executeProbe = async (cachedEndpoint: PrivateNodeEndpoint, generation: number): Promise<void> => {
    try {
      const sample = await runProbe(cachedEndpoint);
      if (lifecycle !== 'running') return;
      if (generation !== endpointGeneration) {
        logger.info({
          code: 'VPS_LINE_PROBE_STALE',
          nodeName: configuredNodeName,
          category: 'endpoint_superseded',
        }, 'VPS line probe result discarded');
        return;
      }
      insertSample(sample);
      const category = failureCategory(sample);
      if (category) {
        await recordProbeFailure(category);
        return;
      }
      if (consecutiveFailures > 0) {
        logger.info({
          code: 'VPS_LINE_PROBE_RECOVERED',
          nodeName: configuredNodeName,
          previousConsecutiveFailures: consecutiveFailures,
        }, 'VPS line probe recovered');
      }
      consecutiveFailures = 0;
    } catch {
      if (lifecycle !== 'running') return;
      if (generation !== endpointGeneration) {
        logger.info({
          code: 'VPS_LINE_PROBE_STALE',
          nodeName: configuredNodeName,
          category: 'endpoint_superseded',
        }, 'VPS line probe result discarded');
        return;
      }
      await recordProbeFailure('probe_execution');
    }
  };

  const probeNow = (): Promise<void> => {
    if (lifecycle !== 'running' || !endpoint) return Promise.resolve();
    if (probePromise) {
      logger.warn({
        code: 'VPS_LINE_PROBE_SKIPPED',
        nodeName: configuredNodeName,
        category: 'overlap',
      }, 'VPS line probe round skipped');
      return probePromise;
    }
    const task = executeProbe(endpoint, endpointGeneration);
    const wrappedTask = task.finally(() => {
      if (probePromise === wrappedTask) probePromise = undefined;
    });
    probePromise = wrappedTask;
    return wrappedTask;
  };

  const scheduleDiscovery = (reason: DiscoveryReason): void => {
    void discover(reason).catch(() => {
      // discover maps all expected failures to safe state and structured logs.
    });
  };

  const start = async (): Promise<void> => {
    if (lifecycle !== 'idle') return;
    if (!configuredNodeName) {
      lifecycle = 'stopped';
      logger.warn({ code: 'VPS_LINE_MONITOR_UNCONFIGURED' }, 'VPS line monitor is not configured');
      return;
    }

    lifecycle = 'running';
    logger.info({
      code: 'VPS_LINE_MONITOR_STARTED',
      nodeName: configuredNodeName,
    }, 'VPS line monitor started');

    try {
      watcher = watchConfig(dependencies.configPath, () => {
        if (lifecycle !== 'running') return;
        if (debounceTimer !== undefined) cancelTimeout(debounceTimer);
        debounceTimer = scheduleTimeout(() => {
          debounceTimer = undefined;
          scheduleDiscovery('file_change');
        }, FILE_CHANGE_DEBOUNCE_MS);
      });
      watcher.on?.('error', handleWatcherError);
    } catch {
      logger.warn({
        code: 'VPS_LINE_CONFIG_WATCH_FAILED',
        nodeName: configuredNodeName,
        category: 'watch_unavailable',
      }, 'VPS line config watch unavailable');
    }

    probeInterval = scheduleInterval(() => {
      void probeNow().catch(() => {
        // probeNow maps failures to structured logs.
      });
    }, PROBE_INTERVAL_MS);
    discoveryInterval = scheduleInterval(() => scheduleDiscovery('fallback'), DISCOVERY_INTERVAL_MS);
    await discover('startup');
  };

  const stop = (): void => {
    if (lifecycle === 'stopped') return;
    lifecycle = 'stopped';
    queuedDiscoveryReason = undefined;
    endpoint = undefined;
    if (probeInterval !== undefined) {
      cancelInterval(probeInterval);
      probeInterval = undefined;
    }
    if (discoveryInterval !== undefined) {
      cancelInterval(discoveryInterval);
      discoveryInterval = undefined;
    }
    if (debounceTimer !== undefined) {
      cancelTimeout(debounceTimer);
      debounceTimer = undefined;
    }
    if (watcher) {
      try {
        watcher.off?.('error', handleWatcherError);
        watcher.close();
      } catch {
        // Shutdown remains safe if the watcher has already closed itself.
      }
      watcher = undefined;
    }
    logger.info({
      code: 'VPS_LINE_MONITOR_STOPPED',
      ...(configuredNodeName ? { nodeName: configuredNodeName } : {}),
    }, 'VPS line monitor stopped');
  };

  return {
    start,
    probeNow,
    getDiscoveryState: () => ({ ...discoveryState }),
    stop,
  };
}
