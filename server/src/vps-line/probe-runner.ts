import { spawn as spawnChildProcess } from 'node:child_process';
import { createConnection } from 'node:net';
import type { PrivateNodeEndpoint } from './node-resolver.js';
import { calculateRoundMetrics, type VpsLineSampleMetrics } from './metrics.js';

const ICMP_REQUEST_COUNT = 10;
const DEFAULT_ICMP_TIMEOUT_MS = 15_000;
const DEFAULT_TERMINATION_GRACE_MS = 1_000;
const DEFAULT_FINALIZATION_GRACE_MS = 1_000;
const DEFAULT_TCP_TIMEOUT_MS = 5_000;
const MAX_PING_OUTPUT_BYTES = 256 * 1024;

type EventListener = (...arguments_: any[]) => void;

type EventSource = {
  on(event: string, listener: EventListener): unknown;
  once(event: string, listener: EventListener): unknown;
  off(event: string, listener: EventListener): unknown;
};

export interface PingProcess extends EventSource {
  stdout: EventSource | null;
  kill(signal?: NodeJS.Signals): boolean;
}

export interface TcpProbeSocket extends EventSource {
  setTimeout(timeoutMs: number): unknown;
  destroy(): unknown;
}

export type SpawnPing = (
  command: string,
  args: string[],
  options: { shell: false; stdio: ['ignore', 'pipe', 'ignore'] },
) => PingProcess;

export type ConnectTcp = (options: { host: string; port: number }) => TcpProbeSocket;

export type ParsedPingOutput = {
  sent: number;
  received: number;
  rtts: number[];
  usable: boolean;
};

export type IcmpProbeResult = ParsedPingOutput & {
  timedOut: boolean;
};

export type VpsLineProbeSample = VpsLineSampleMetrics & {
  nodeName: string;
  icmpUsable: boolean;
};

const defaultSpawn: SpawnPing = (command, args, options) => (
  spawnChildProcess(command, args, options) as unknown as PingProcess
);

const defaultConnect: ConnectTcp = options => createConnection(options) as unknown as TcpProbeSocket;

function validPacketCounts(sent: number, received: number): boolean {
  return Number.isInteger(sent) && sent >= 0 && Number.isInteger(received) && received >= 0 && received <= sent;
}

export function parsePingOutput(output: string): ParsedPingOutput {
  const rtts = [...output.matchAll(/\btime\s*[=<]\s*(\d+(?:\.\d+)?)\s*ms\b/gi)]
    .map(match => Number(match[1]))
    .filter(value => Number.isFinite(value) && value >= 0);

  const unixSummary = output.match(/(\d+)\s+packets?\s+transmitted,\s*(\d+)\s+(?:packets?\s+)?received\b/i);
  const windowsSummary = output.match(/Packets:\s*Sent\s*=\s*(\d+),\s*Received\s*=\s*(\d+)\b/i);
  const summary = unixSummary ?? windowsSummary;
  const summarySent = summary ? Number(summary[1]) : Number.NaN;
  const summaryReceived = summary ? Number(summary[2]) : Number.NaN;
  const hasValidSummary = validPacketCounts(summarySent, summaryReceived);
  const sent = hasValidSummary ? summarySent : ICMP_REQUEST_COUNT;
  const received = hasValidSummary ? summaryReceived : Math.min(rtts.length, sent);

  return { sent, received, rtts, usable: received > 0 && rtts.length > 0 };
}

export async function runIcmpProbe(
  host: string,
  options: {
    spawn?: SpawnPing;
    timeoutMs?: number;
    terminationGraceMs?: number;
    finalizationGraceMs?: number;
  } = {},
): Promise<IcmpProbeResult> {
  const spawn = options.spawn ?? defaultSpawn;
  const timeoutMs = options.timeoutMs ?? DEFAULT_ICMP_TIMEOUT_MS;
  const terminationGraceMs = options.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS;
  const finalizationGraceMs = options.finalizationGraceMs ?? DEFAULT_FINALIZATION_GRACE_MS;
  let child: PingProcess;
  try {
    child = spawn('/sbin/ping', ['-c', String(ICMP_REQUEST_COUNT), '-W', '2000', '--', host], {
      shell: false,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return { ...parsePingOutput(''), timedOut: false };
  }

  return new Promise(resolve => {
    let output = '';
    let settled = false;
    let timedOut = false;
    let probeTimer: ReturnType<typeof setTimeout> | undefined;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined;

    const appendOutput = (chunk: unknown) => {
      if (output.length >= MAX_PING_OUTPUT_BYTES) return;
      const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      output += text.slice(0, MAX_PING_OUTPUT_BYTES - output.length);
    };
    const cleanup = () => {
      if (probeTimer) clearTimeout(probeTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      if (fallbackTimer) clearTimeout(fallbackTimer);
      child.stdout?.off('data', appendOutput);
      child.off('close', handleClose);
      child.off('error', handleError);
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ ...parsePingOutput(output), timedOut });
    };
    const handleClose = () => finish();
    const handleError = () => {
      if (!timedOut) finish();
    };
    const signalChild = (signal: NodeJS.Signals) => {
      try {
        child.kill(signal);
      } catch {
        // The bounded fallback still guarantees settlement and cleanup.
      }
    };
    const handleTimeout = () => {
      timedOut = true;
      signalChild('SIGTERM');
      if (settled) return;
      forceKillTimer = setTimeout(() => {
        signalChild('SIGKILL');
        if (settled) return;
        fallbackTimer = setTimeout(finish, Math.max(1, finalizationGraceMs));
      }, Math.max(1, terminationGraceMs));
    };

    child.stdout?.on('data', appendOutput);
    child.once('close', handleClose);
    child.on('error', handleError);
    probeTimer = setTimeout(handleTimeout, Math.max(1, timeoutMs));
  });
}

export async function runTcpProbe(
  host: string,
  port: number,
  options: { connect?: ConnectTcp; timeoutMs?: number } = {},
): Promise<boolean> {
  const connect = options.connect ?? defaultConnect;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TCP_TIMEOUT_MS;

  return new Promise(resolve => {
    let socket: TcpProbeSocket;
    try {
      socket = connect({ host, port });
    } catch {
      resolve(false);
      return;
    }

    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      socket.off('connect', handleConnect);
      socket.off('error', handleFailure);
      socket.off('timeout', handleFailure);
      socket.off('close', handleClose);
      socket.destroy();
    };
    const finish = (connected: boolean) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(connected);
    };
    const handleConnect = () => finish(true);
    const handleFailure = () => finish(false);
    const handleClose = () => finish(false);
    const timer = setTimeout(handleFailure, Math.max(1, timeoutMs));

    socket.once('connect', handleConnect);
    socket.once('error', handleFailure);
    socket.once('timeout', handleFailure);
    socket.once('close', handleClose);
    socket.setTimeout(Math.max(1, timeoutMs));
  });
}

export function createProbeSample(input: {
  probedAt: number;
  nodeName: string;
  icmp: IcmpProbeResult;
  tcpConnected: boolean;
}): VpsLineProbeSample {
  const roundMetrics = calculateRoundMetrics(input.icmp.rtts);
  return {
    probedAt: input.probedAt,
    nodeName: input.nodeName,
    sent: input.icmp.sent,
    received: input.icmp.received,
    ...roundMetrics,
    tcpState: input.tcpConnected ? 'up' : 'down',
    icmpUsable: input.icmp.usable && roundMetrics.medianLatencyMs !== null,
  };
}

export async function runProbeRound(
  endpoint: PrivateNodeEndpoint,
  adapters: {
    spawn?: SpawnPing;
    connect?: ConnectTcp;
    now?: () => number;
    icmpTimeoutMs?: number;
    tcpTimeoutMs?: number;
  } = {},
): Promise<VpsLineProbeSample> {
  const [icmp, tcpConnected] = await Promise.all([
    runIcmpProbe(endpoint.host, { spawn: adapters.spawn, timeoutMs: adapters.icmpTimeoutMs }),
    runTcpProbe(endpoint.host, endpoint.port, { connect: adapters.connect, timeoutMs: adapters.tcpTimeoutMs }),
  ]);
  return createProbeSample({
    probedAt: (adapters.now ?? Date.now)(),
    nodeName: endpoint.name,
    icmp,
    tcpConnected,
  });
}
