import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export const ISTOREOS_SERVICE_ID = 'istoreos-router';
export const ISTOREOS_MANAGEMENT_URL = 'http://192.168.31.10/';
export const ISTOREOS_REMOTE_COMMAND = [
  "xray_ok=0",
  "pgrep -f '/tmp/etc/passwall2/bin/xray run' >/dev/null 2>&1 && xray_ok=1",
  "proxy_result=$(curl --noproxy '' --proxy socks5h://127.0.0.1:1070 --connect-timeout 8 --max-time 15 -sS -o /dev/null -w '%{http_code} %{time_total}' https://www.google.com/generate_204 2>/dev/null || printf '000 0')",
  "printf 'xray=%s\\nproxy=%s\\n' \"$xray_ok\" \"$proxy_result\"",
].join('; ');

const SSH_TIMEOUT_MS = 25_000;
const SSH_MAX_BUFFER = 16 * 1024;
const PROBE_INTERVAL_MS = 5 * 60_000;

export type IStoreOSMonitorState = 'checking' | 'healthy' | 'proxy_error' | 'offline';

export interface IStoreOSProbeResult {
  state: IStoreOSMonitorState;
  status: 'running' | 'error' | 'stopped';
  sshOk: boolean;
  xrayOk: boolean | null;
  proxyOk: boolean | null;
  proxyLatencyMs: number | null;
  checkedAt: number | null;
  latencyMs: number;
}

export interface IStoreOSExecOptions {
  timeout: number;
  maxBuffer: number;
}

export type IStoreOSExec = (
  args: readonly string[],
  options?: IStoreOSExecOptions,
) => Promise<{ stdout: string; stderr: string }>;

export interface ParsedIStoreOSProbeOutput {
  xrayOk: boolean;
  proxyOk: boolean;
  proxyLatencyMs: number;
}

export interface IStoreOSMonitorOptions {
  execFile?: IStoreOSExec;
  persist: (serviceId: string, status: IStoreOSProbeResult['status'], latencyMs: number | null) => void;
  now?: () => number;
  intervalMs?: number;
}

const promisifiedExecFile = promisify(execFile) as unknown as (
  file: string,
  args: readonly string[],
  options: IStoreOSExecOptions & { shell: false },
) => Promise<{ stdout: string; stderr: string }>;

const defaultExecFile: IStoreOSExec = (args, options = { timeout: SSH_TIMEOUT_MS, maxBuffer: SSH_MAX_BUFFER }) =>
  promisifiedExecFile('ssh', args, { ...options, shell: false });

export function buildIStoreOSSshArgs(): string[] {
  return [
    '-i', '/Users/cx/.ssh/id_ed25519',
    '-p', '22',
    '-o', 'IdentitiesOnly=yes',
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=5',
    'root@192.168.31.10',
    ISTOREOS_REMOTE_COMMAND,
  ];
}

export function parseIStoreOSProbeOutput(output: string): ParsedIStoreOSProbeOutput | null {
  const xrayMatch = output.match(/(?:^|\n)xray=(0|1)(?:\n|$)/);
  const proxyMatch = output.match(/(?:^|\n)proxy=(\d{3})\s+([0-9]+(?:\.[0-9]+)?)(?:\n|$)/);
  if (!xrayMatch || !proxyMatch) return null;

  const proxySeconds = Number(proxyMatch[2]);
  if (!Number.isFinite(proxySeconds) || proxySeconds < 0) return null;

  return {
    xrayOk: xrayMatch[1] === '1',
    proxyOk: proxyMatch[1] === '204',
    proxyLatencyMs: Math.round(proxySeconds * 1000),
  };
}

function checkingResult(): IStoreOSProbeResult {
  return {
    state: 'checking',
    status: 'stopped',
    sshOk: false,
    xrayOk: null,
    proxyOk: null,
    proxyLatencyMs: null,
    checkedAt: null,
    latencyMs: 0,
  };
}

function offlineResult(now: number): IStoreOSProbeResult {
  return {
    state: 'offline',
    status: 'stopped',
    sshOk: false,
    xrayOk: null,
    proxyOk: null,
    proxyLatencyMs: null,
    checkedAt: now,
    latencyMs: 0,
  };
}

export function createIStoreOSMonitor(options: IStoreOSMonitorOptions) {
  const execRunner = options.execFile ?? defaultExecFile;
  const now = options.now ?? Date.now;
  const intervalMs = options.intervalMs ?? PROBE_INTERVAL_MS;
  let latest = checkingResult();
  let inFlight: Promise<IStoreOSProbeResult> | null = null;
  let timer: NodeJS.Timeout | null = null;

  const probe = (): Promise<IStoreOSProbeResult> => {
    if (inFlight) return inFlight;

    inFlight = (async () => {
      let parsed: ParsedIStoreOSProbeOutput | null = null;
      try {
        const result = await execRunner(buildIStoreOSSshArgs(), {
          timeout: SSH_TIMEOUT_MS,
          maxBuffer: SSH_MAX_BUFFER,
        });
        parsed = parseIStoreOSProbeOutput(result.stdout);
      } catch {
        parsed = null;
      }

      const checkedAt = now();
      const next = parsed === null
        ? offlineResult(checkedAt)
        : {
            state: parsed.xrayOk && parsed.proxyOk ? 'healthy' as const : 'proxy_error' as const,
            status: parsed.xrayOk && parsed.proxyOk ? 'running' as const : 'error' as const,
            sshOk: true,
            xrayOk: parsed.xrayOk,
            proxyOk: parsed.proxyOk,
            proxyLatencyMs: parsed.proxyLatencyMs,
            checkedAt,
            latencyMs: parsed.proxyOk ? parsed.proxyLatencyMs : 0,
          };

      latest = next;
      try {
        options.persist(ISTOREOS_SERVICE_ID, next.status, next.latencyMs || null);
      } catch {
        // A persistence failure must not turn a completed device probe into an unknown state.
      }
      return next;
    })().finally(() => {
      inFlight = null;
    });

    return inFlight;
  };

  return {
    probe,
    getLatest: () => latest,
    start: () => {
      if (timer) return;
      void probe();
      timer = setInterval(() => void probe(), intervalMs);
    },
    stop: () => {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    },
  };
}
