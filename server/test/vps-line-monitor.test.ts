import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import * as monitorModule from '../src/vps-line/monitor.js';
import type { PrivateNodeEndpoint } from '../src/vps-line/node-resolver.js';
import type { VpsLineProbeSample } from '../src/vps-line/probe-runner.js';

type TimerHandle = {
  active: boolean;
  callback: () => void;
  delayMs: number;
  kind: 'interval' | 'timeout';
};

class FakeScheduler {
  handles: TimerHandle[] = [];

  setInterval = (callback: () => void, delayMs: number): TimerHandle => {
    const handle: TimerHandle = { active: true, callback, delayMs, kind: 'interval' };
    this.handles.push(handle);
    return handle;
  };

  clearInterval = (handle: TimerHandle): void => {
    handle.active = false;
  };

  setTimeout = (callback: () => void, delayMs: number): TimerHandle => {
    const handle: TimerHandle = { active: true, callback, delayMs, kind: 'timeout' };
    this.handles.push(handle);
    return handle;
  };

  clearTimeout = (handle: TimerHandle): void => {
    handle.active = false;
  };

  fireInterval(delayMs: number): void {
    const handle = this.handles.find(candidate => (
      candidate.active && candidate.kind === 'interval' && candidate.delayMs === delayMs
    ));
    assert.ok(handle, `missing active ${delayMs}ms interval`);
    handle.callback();
  }

  fireLatestTimeout(delayMs: number): void {
    const handle = this.handles.findLast(candidate => (
      candidate.active && candidate.kind === 'timeout' && candidate.delayMs === delayMs
    ));
    assert.ok(handle, `missing active ${delayMs}ms timeout`);
    handle.active = false;
    handle.callback();
  }
}

type LogEntry = {
  level: 'info' | 'warn' | 'error';
  context: Record<string, unknown>;
  message: string;
};

function createLogger(entries: LogEntry[]) {
  return {
    info(context: Record<string, unknown>, message: string) {
      entries.push({ level: 'info', context, message });
    },
    warn(context: Record<string, unknown>, message: string) {
      entries.push({ level: 'warn', context, message });
    },
    error(context: Record<string, unknown>, message: string) {
      entries.push({ level: 'error', context, message });
    },
  };
}

const successfulSample = (probedAt = 1): VpsLineProbeSample => ({
  probedAt,
  nodeName: 'Private VPS',
  sent: 10,
  received: 10,
  medianLatencyMs: 100,
  p95LatencyMs: 120,
  jitterMs: 5,
  tcpState: 'up',
  icmpUsable: true,
});

const failedSample = (kind: 'tcp' | 'icmp' | 'both', probedAt = 1): VpsLineProbeSample => ({
  probedAt,
  nodeName: 'Private VPS',
  sent: 10,
  received: kind === 'icmp' || kind === 'both' ? 0 : 10,
  medianLatencyMs: kind === 'icmp' || kind === 'both' ? null : 100,
  p95LatencyMs: kind === 'icmp' || kind === 'both' ? null : 120,
  jitterMs: kind === 'icmp' || kind === 'both' ? null : 5,
  tcpState: kind === 'tcp' || kind === 'both' ? 'down' : 'up',
  icmpUsable: kind !== 'icmp' && kind !== 'both',
});

async function settle(): Promise<void> {
  await new Promise<void>(resolve => setImmediate(resolve));
}

function monitorFactory() {
  const createVpsLineMonitor = (monitorModule as unknown as {
    createVpsLineMonitor?: (dependencies: Record<string, unknown>) => {
      start(): Promise<void>;
      probeNow(): Promise<void>;
      getDiscoveryState(): unknown;
      stop(): void;
    };
  }).createVpsLineMonitor;
  assert.equal(typeof createVpsLineMonitor, 'function');
  return createVpsLineMonitor;
}

test('blank node configuration stays safely unconfigured and starts no work', async () => {
  const scheduler = new FakeScheduler();
  const logs: LogEntry[] = [];
  let reads = 0;
  let probes = 0;
  let watches = 0;
  const monitor = monitorFactory()({
    configuredNodeName: '   ',
    configPath: '/private/clash-verge.yaml',
    readConfig: async () => { reads += 1; return 'never'; },
    watchConfig: () => { watches += 1; return { close() {} }; },
    runProbe: async () => { probes += 1; return successfulSample(); },
    insertSample: () => {},
    logger: createLogger(logs),
    ...scheduler,
  });

  await monitor.start();
  await monitor.start();
  await monitor.probeNow();

  assert.deepEqual(monitor.getDiscoveryState(), { status: 'unconfigured' });
  assert.equal(reads, 0);
  assert.equal(probes, 0);
  assert.equal(watches, 0);
  assert.equal(scheduler.handles.length, 0);
  assert.deepEqual(logs, [{
    level: 'warn',
    context: { code: 'VPS_LINE_MONITOR_UNCONFIGURED' },
    message: 'VPS line monitor is not configured',
  }]);
});

test('startup discovers once, probes cached endpoint every 60 seconds, and falls back every 30 minutes', async () => {
  const scheduler = new FakeScheduler();
  const logs: LogEntry[] = [];
  const endpoints: PrivateNodeEndpoint[] = [];
  const samples: VpsLineProbeSample[] = [];
  let reads = 0;
  let watchPath = '';
  const monitor = monitorFactory()({
    configuredNodeName: ' Private VPS ',
    configPath: '/private/clash-verge.yaml',
    readConfig: async () => {
      reads += 1;
      return `proxies:\n  - name: Private VPS\n    server: endpoint-${reads}.example.com\n    port: 443\n`;
    },
    watchConfig: (filePath: string) => {
      watchPath = filePath;
      return { close() {} };
    },
    runProbe: async (endpoint: PrivateNodeEndpoint) => {
      endpoints.push(endpoint);
      return successfulSample(reads);
    },
    insertSample: (sample: VpsLineProbeSample) => samples.push(sample),
    logger: createLogger(logs),
    ...scheduler,
  });

  await monitor.start();
  assert.equal(reads, 1);
  assert.equal(watchPath, '/private/clash-verge.yaml');
  assert.deepEqual(monitor.getDiscoveryState(), { status: 'resolved', nodeName: 'Private VPS' });
  assert.equal(JSON.stringify(monitor.getDiscoveryState()).includes('endpoint-1'), false);

  scheduler.fireInterval(60_000);
  await settle();
  assert.equal(reads, 1, 'the probe loop must not re-read Clash configuration');
  assert.equal(endpoints[0].host, 'endpoint-1.example.com');
  assert.deepEqual(samples, [successfulSample(1)]);

  scheduler.fireInterval(30 * 60_000);
  await settle();
  assert.equal(reads, 2);

  scheduler.fireInterval(60_000);
  await settle();
  assert.equal(endpoints[1].host, 'endpoint-2.example.com');
});

test('file watch events debounce for two seconds and only trigger a fresh read', async () => {
  const scheduler = new FakeScheduler();
  let watchListener: (() => void) | undefined;
  let reads = 0;
  const monitor = monitorFactory()({
    configuredNodeName: 'Private VPS',
    configPath: '/private/clash-verge.yaml',
    readConfig: async () => {
      reads += 1;
      return `proxies:\n  - name: Private VPS\n    server: endpoint-${reads}.example.com\n    port: 443\n`;
    },
    watchConfig: (_filePath: string, listener: () => void) => {
      watchListener = listener;
      return { close() {} };
    },
    runProbe: async () => successfulSample(),
    insertSample: () => {},
    logger: createLogger([]),
    ...scheduler,
  });

  await monitor.start();
  watchListener?.();
  watchListener?.();
  watchListener?.();
  assert.equal(reads, 1);
  assert.equal(scheduler.handles.filter(handle => handle.active && handle.kind === 'timeout').length, 1);

  scheduler.fireLatestTimeout(2_000);
  await settle();
  assert.equal(reads, 2);
});

test('queues one latest follow-up discovery when triggers arrive during an active discovery', async () => {
  const scheduler = new FakeScheduler();
  const logs: LogEntry[] = [];
  const endpoints: PrivateNodeEndpoint[] = [];
  let watchListener: (() => void) | undefined;
  let resolveFallback: ((content: string) => void) | undefined;
  let reads = 0;
  const monitor = monitorFactory()({
    configuredNodeName: 'Private VPS',
    configPath: '/private/clash-verge.yaml',
    readConfig: async () => {
      reads += 1;
      if (reads === 1) {
        return 'proxies:\n  - name: Private VPS\n    server: startup.example.com\n    port: 443\n';
      }
      if (reads === 2) {
        return new Promise<string>(resolve => { resolveFallback = resolve; });
      }
      return 'proxies:\n  - name: Private VPS\n    server: follow-up.example.com\n    port: 8443\n';
    },
    watchConfig: (_filePath: string, listener: () => void) => {
      watchListener = listener;
      return { close() {} };
    },
    runProbe: async (endpoint: PrivateNodeEndpoint) => {
      endpoints.push(endpoint);
      return successfulSample();
    },
    insertSample: () => {},
    logger: createLogger(logs),
    ...scheduler,
  });

  await monitor.start();
  scheduler.fireInterval(30 * 60_000);
  await settle();
  assert.equal(reads, 2);

  scheduler.fireInterval(30 * 60_000);
  watchListener?.();
  scheduler.fireLatestTimeout(2_000);
  assert.equal(reads, 2, 'triggers must not overlap the active discovery');

  resolveFallback?.('proxies:\n  - name: Private VPS\n    server: fallback.example.com\n    port: 443\n');
  await settle();
  await settle();

  assert.equal(reads, 3, 'concurrent triggers must collapse to one follow-up read');
  const reasons = logs
    .filter(entry => entry.context.code === 'VPS_LINE_DISCOVERY_RESOLVED')
    .map(entry => entry.context.reason);
  assert.deepEqual(reasons, ['startup', 'fallback', 'file_change']);
  await monitor.probeNow();
  assert.equal(endpoints.at(-1)?.host, 'follow-up.example.com');
});

test('stop prevents a queued discovery follow-up from running', async () => {
  const scheduler = new FakeScheduler();
  let watchListener: (() => void) | undefined;
  let resolveFallback: ((content: string) => void) | undefined;
  let reads = 0;
  const monitor = monitorFactory()({
    configuredNodeName: 'Private VPS',
    configPath: '/private/clash-verge.yaml',
    readConfig: async () => {
      reads += 1;
      if (reads === 1) {
        return 'proxies:\n  - name: Private VPS\n    server: startup.example.com\n    port: 443\n';
      }
      return new Promise<string>(resolve => { resolveFallback = resolve; });
    },
    watchConfig: (_filePath: string, listener: () => void) => {
      watchListener = listener;
      return { close() {} };
    },
    runProbe: async () => successfulSample(),
    insertSample: () => {},
    logger: createLogger([]),
    ...scheduler,
  });

  await monitor.start();
  scheduler.fireInterval(30 * 60_000);
  await settle();
  watchListener?.();
  scheduler.fireLatestTimeout(2_000);
  monitor.stop();
  resolveFallback?.('proxies:\n  - name: Private VPS\n    server: stopped.example.com\n    port: 443\n');
  await settle();
  await settle();

  assert.equal(reads, 2);
});

test('asynchronous watcher errors are sanitized and leave fallback discovery active', async () => {
  const scheduler = new FakeScheduler();
  const logs: LogEntry[] = [];
  const watcher = new EventEmitter() as EventEmitter & { close(): void };
  watcher.close = () => {};
  let reads = 0;
  const monitor = monitorFactory()({
    configuredNodeName: 'Private VPS',
    configPath: '/private/clash-verge.yaml',
    readConfig: async () => {
      reads += 1;
      return 'proxies:\n  - name: Private VPS\n    server: safe.example.com\n    port: 443\n';
    },
    watchConfig: () => watcher,
    runProbe: async () => successfulSample(),
    insertSample: () => {},
    logger: createLogger(logs),
    ...scheduler,
  });

  await monitor.start();
  assert.doesNotThrow(() => {
    watcher.emit('error', new Error('secret endpoint detail from watcher'));
  });
  scheduler.fireInterval(30 * 60_000);
  await settle();

  assert.equal(reads, 2);
  const serialized = JSON.stringify(logs);
  assert.equal(serialized.includes('secret endpoint detail'), false);
  assert.equal(logs.some(entry => entry.context.code === 'VPS_LINE_CONFIG_WATCH_FAILED'), true);
  monitor.stop();
  assert.equal(watcher.listenerCount('error'), 0);
});

test('invalid rediscovery clears the cached endpoint until a later recovery', async () => {
  const scheduler = new FakeScheduler();
  const configs = [
    'proxies:\n  - name: Private VPS\n    server: first.example.com\n    port: 443\n',
    'proxies: []\n',
    'proxies:\n  - name: Private VPS\n    server: recovered.example.com\n    port: 8443\n',
  ];
  const endpoints: PrivateNodeEndpoint[] = [];
  const monitor = monitorFactory()({
    configuredNodeName: 'Private VPS',
    configPath: '/private/clash-verge.yaml',
    readConfig: async () => configs.shift() ?? 'proxies: []\n',
    watchConfig: () => ({ close() {} }),
    runProbe: async (endpoint: PrivateNodeEndpoint) => {
      endpoints.push(endpoint);
      return successfulSample();
    },
    insertSample: () => {},
    logger: createLogger([]),
    ...scheduler,
  });

  await monitor.start();
  await monitor.probeNow();
  scheduler.fireInterval(30 * 60_000);
  await settle();

  assert.deepEqual(monitor.getDiscoveryState(), {
    status: 'unresolved',
    nodeName: 'Private VPS',
    code: 'PRIVATE_NODE_NOT_FOUND',
  });
  await monitor.probeNow();
  assert.equal(endpoints.length, 1, 'an invalidated endpoint must not be probed');

  scheduler.fireInterval(30 * 60_000);
  await settle();
  assert.deepEqual(monitor.getDiscoveryState(), { status: 'resolved', nodeName: 'Private VPS' });
  await monitor.probeNow();
  assert.equal(endpoints[1].host, 'recovered.example.com');
});

test('does not persist an in-flight probe after rediscovery supersedes its endpoint', async () => {
  const scheduler = new FakeScheduler();
  const samples: VpsLineProbeSample[] = [];
  const configs = [
    'proxies:\n  - name: Private VPS\n    server: old.example.com\n    port: 443\n',
    'proxies:\n  - name: Private VPS\n    server: new.example.com\n    port: 8443\n',
  ];
  let resolveOldProbe: ((sample: VpsLineProbeSample) => void) | undefined;
  const monitor = monitorFactory()({
    configuredNodeName: 'Private VPS',
    configPath: '/private/clash-verge.yaml',
    readConfig: async () => configs.shift() ?? 'proxies: []\n',
    watchConfig: () => ({ close() {} }),
    runProbe: async (endpoint: PrivateNodeEndpoint) => {
      if (endpoint.host === 'old.example.com') {
        return new Promise<VpsLineProbeSample>(resolve => { resolveOldProbe = resolve; });
      }
      return successfulSample(2);
    },
    insertSample: (sample: VpsLineProbeSample) => samples.push(sample),
    logger: createLogger([]),
    ...scheduler,
  });

  await monitor.start();
  const oldProbe = monitor.probeNow();
  scheduler.fireInterval(30 * 60_000);
  await settle();
  resolveOldProbe?.(failedSample('both', 1));
  await oldProbe;

  assert.deepEqual(samples, []);
  await monitor.probeNow();
  assert.deepEqual(samples, [successfulSample(2)]);
});

test('keeps an in-flight probe valid when fallback discovery finds the unchanged endpoint', async () => {
  const scheduler = new FakeScheduler();
  const logs: LogEntry[] = [];
  const samples: VpsLineProbeSample[] = [];
  let resolveProbe: ((sample: VpsLineProbeSample) => void) | undefined;
  let reads = 0;
  const monitor = monitorFactory()({
    configuredNodeName: 'Private VPS',
    configPath: '/private/clash-verge.yaml',
    readConfig: async () => {
      reads += 1;
      return 'proxies:\n  - name: Private VPS\n    server: unchanged.example.com\n    port: 443\n';
    },
    watchConfig: () => ({ close() {} }),
    runProbe: async () => new Promise<VpsLineProbeSample>(resolve => {
      resolveProbe = resolve;
    }),
    insertSample: (sample: VpsLineProbeSample) => samples.push(sample),
    logger: createLogger(logs),
    ...scheduler,
  });

  await monitor.start();
  const probe = monitor.probeNow();
  scheduler.fireInterval(30 * 60_000);
  await settle();
  resolveProbe?.(successfulSample(1));
  await probe;

  assert.equal(reads, 2);
  assert.deepEqual(samples, [successfulSample(1)]);
  assert.equal(logs.some(entry => entry.context.code === 'VPS_LINE_PROBE_STALE'), false);
});

test('does not count a rejected stale probe against the superseding endpoint', async () => {
  const scheduler = new FakeScheduler();
  const logs: LogEntry[] = [];
  const configs = [
    'proxies:\n  - name: Private VPS\n    server: old.example.com\n    port: 443\n',
    'proxies:\n  - name: Private VPS\n    server: new.example.com\n    port: 8443\n',
  ];
  let rejectOldProbe: ((error: Error) => void) | undefined;
  const monitor = monitorFactory()({
    configuredNodeName: 'Private VPS',
    configPath: '/private/clash-verge.yaml',
    readConfig: async () => configs.shift() ?? 'proxies: []\n',
    watchConfig: () => ({ close() {} }),
    runProbe: async () => new Promise<VpsLineProbeSample>((_resolve, reject) => {
      rejectOldProbe = reject;
    }),
    insertSample: () => {},
    logger: createLogger(logs),
    ...scheduler,
  });

  await monitor.start();
  const oldProbe = monitor.probeNow();
  scheduler.fireInterval(30 * 60_000);
  await settle();
  rejectOldProbe?.(new Error('secret old endpoint failure'));
  await oldProbe;

  assert.equal(logs.some(entry => entry.context.code === 'VPS_LINE_PROBE_ERROR'), false);
  assert.equal(logs.some(entry => entry.context.code === 'VPS_LINE_PROBE_STALE'), true);
  assert.equal(JSON.stringify(logs).includes('secret old endpoint failure'), false);
});

test('three failed rounds trigger early rediscovery with cooldown and useful recovery resets the count', async () => {
  const scheduler = new FakeScheduler();
  const logs: LogEntry[] = [];
  const queue = [
    failedSample('tcp', 1),
    failedSample('icmp', 2),
    failedSample('both', 3),
    failedSample('tcp', 4),
    successfulSample(5),
    failedSample('icmp', 6),
    failedSample('icmp', 7),
    failedSample('icmp', 8),
  ];
  let reads = 0;
  let now = 10_000;
  const monitor = monitorFactory()({
    configuredNodeName: 'Private VPS',
    configPath: '/private/clash-verge.yaml',
    readConfig: async () => {
      reads += 1;
      return 'proxies:\n  - name: Private VPS\n    server: safe.example.com\n    port: 443\n';
    },
    watchConfig: () => ({ close() {} }),
    runProbe: async () => queue.shift() ?? successfulSample(),
    insertSample: () => {},
    logger: createLogger(logs),
    now: () => now,
    earlyRediscoveryCooldownMs: 5 * 60_000,
    ...scheduler,
  });

  await monitor.start();
  await monitor.probeNow();
  await monitor.probeNow();
  assert.equal(reads, 1);
  await monitor.probeNow();
  assert.equal(reads, 2, 'third consecutive failed round triggers early discovery');
  await monitor.probeNow();
  assert.equal(reads, 2, 'cooldown prevents a discovery parse loop');
  await monitor.probeNow();
  await monitor.probeNow();
  await monitor.probeNow();
  assert.equal(reads, 2, 'a useful round reset means two later failures are insufficient');
  now += 5 * 60_000;
  await monitor.probeNow();
  assert.equal(reads, 3);

  const failureLogs = logs.filter(entry => entry.context.code === 'VPS_LINE_PROBE_FAILED');
  assert.deepEqual(failureLogs.slice(0, 3).map(entry => ({
    category: entry.context.category,
    count: entry.context.consecutiveFailures,
  })), [
    { category: 'tcp_down', count: 1 },
    { category: 'icmp_no_replies', count: 2 },
    { category: 'tcp_down_and_icmp_no_replies', count: 3 },
  ]);
  assert.equal(logs.some(entry => entry.context.code === 'VPS_LINE_PROBE_RECOVERED'), true);
});

test('probe rounds never overlap and rejected probes are handled without leaking endpoint details', async () => {
  const scheduler = new FakeScheduler();
  const logs: LogEntry[] = [];
  let rejectProbe: ((error: Error) => void) | undefined;
  let probes = 0;
  const monitor = monitorFactory()({
    configuredNodeName: 'Private VPS',
    configPath: '/private/clash-verge.yaml',
    readConfig: async () => 'proxies:\n  - name: Private VPS\n    server: secret-endpoint.example.com\n    port: 65432\n    uuid: never-log-this\n',
    watchConfig: () => ({ close() {} }),
    runProbe: async () => {
      probes += 1;
      return new Promise<VpsLineProbeSample>((_resolve, reject) => { rejectProbe = reject; });
    },
    insertSample: () => {},
    logger: createLogger(logs),
    ...scheduler,
  });

  await monitor.start();
  const first = monitor.probeNow();
  const second = monitor.probeNow();
  assert.equal(probes, 1);
  rejectProbe?.(new Error('raw failure at secret-endpoint.example.com:65432; never-log-this'));
  await Promise.all([first, second]);

  const serialized = JSON.stringify(logs);
  assert.equal(serialized.includes('secret-endpoint'), false);
  assert.equal(serialized.includes('65432'), false);
  assert.equal(serialized.includes('never-log-this'), false);
  assert.equal(serialized.includes('Private VPS'), true);
  assert.equal(logs.some(entry => entry.context.code === 'VPS_LINE_PROBE_ERROR'), true);
});

test('stop closes the watcher and clears every scheduled monitor timer', async () => {
  const scheduler = new FakeScheduler();
  let watchListener: (() => void) | undefined;
  let watcherCloses = 0;
  const monitor = monitorFactory()({
    configuredNodeName: 'Private VPS',
    configPath: '/private/clash-verge.yaml',
    readConfig: async () => 'proxies:\n  - name: Private VPS\n    server: safe.example.com\n    port: 443\n',
    watchConfig: (_filePath: string, listener: () => void) => {
      watchListener = listener;
      return { close() { watcherCloses += 1; } };
    },
    runProbe: async () => failedSample('both'),
    insertSample: () => {},
    logger: createLogger([]),
    ...scheduler,
  });

  await monitor.start();
  watchListener?.();
  await monitor.probeNow();
  await monitor.probeNow();
  await monitor.probeNow();
  monitor.stop();
  monitor.stop();

  assert.equal(watcherCloses, 1);
  assert.equal(scheduler.handles.every(handle => !handle.active), true);
});
