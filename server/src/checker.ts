import { fetch } from 'undici';
import { exec } from 'child_process';
import { promisify } from 'util';
import { SERVICES, type ServiceConfig } from './config.js';
import { insertServiceCheck } from './db.js';
import { resolveIp } from './utils.js';

const execAsync = promisify(exec);
const IS_LINUX = process.platform === 'linux';
const IS_MACOS = process.platform === 'darwin';

export interface ServiceStatus {
  id: string;
  status: 'running' | 'stopped' | 'error' | 'restarting';
  latencyMs: number;
  checkedAt: number;
  startedAt?: number;
}

export interface LogLine {
  level: 'info' | 'warn' | 'error';
  text: string;
}

async function httpProbe(url: string): Promise<{ status: 'running' | 'stopped' | 'error'; latencyMs: number }> {
  const start = Date.now();
  try {
    await fetch(url, { signal: AbortSignal.timeout(5000) });
    return { status: 'running', latencyMs: Date.now() - start };
  } catch (err: unknown) {
    const latencyMs = Date.now() - start;
    if (err instanceof Error && err.message.includes('ECONNREFUSED')) {
      return { status: 'stopped', latencyMs };
    }
    return { status: 'error', latencyMs };
  }
}

// ---- Linux: systemd ----

async function systemdCheck(unit: string): Promise<{ status: 'running' | 'stopped' | 'error'; startedAt?: number } | null> {
  try {
    const { stdout } = await execAsync(`systemctl is-active ${unit}`, { timeout: 3000 });
    const state = stdout.trim();
    let startedAt: number | undefined;
    try {
      const { stdout: ts } = await execAsync(
        `systemctl show ${unit} --property=ActiveEnterTimestamp --value`,
        { timeout: 3000 }
      );
      const d = new Date(ts.trim());
      if (!isNaN(d.getTime())) startedAt = d.getTime();
    } catch { /* ignore */ }

    if (state === 'active') return { status: 'running', startedAt };
    if (state === 'inactive') return { status: 'stopped' };
    return { status: 'error' };
  } catch {
    return null;
  }
}

async function systemdManage(unit: string, action: 'start' | 'stop' | 'restart'): Promise<void> {
  await execAsync(`systemctl ${action} ${unit}`, { timeout: 15000 });
}

async function systemdLogs(unit: string, lines: number): Promise<LogLine[]> {
  try {
    const { stdout } = await execAsync(
      `journalctl -n ${lines} -u ${unit} --no-pager -o short`,
      { timeout: 8000 }
    );
    return stdout.split('\n').filter(l => l.trim()).map(line => ({
      level: parseLogLevel(line),
      text: line,
    }));
  } catch {
    return [];
  }
}

// ---- macOS: launchctl (LaunchAgent / LaunchDaemon) ----

async function launchctlCheck(label: string): Promise<{ status: 'running' | 'stopped' | 'error' } | null> {
  try {
    const { stdout } = await execAsync(`launchctl list ${label}`, { timeout: 3000 });
    // Output contains "PID" = <number> if running, or no PID if stopped
    if (/\"PID\"\s*=\s*\d+/.test(stdout)) return { status: 'running' };
    return { status: 'stopped' };
  } catch {
    // Non-zero exit means label not found
    return null;
  }
}

async function launchctlManage(label: string, plistPath: string, action: 'start' | 'stop' | 'restart'): Promise<void> {
  const uid = process.getuid?.() ?? 501;
  const domain = `gui/${uid}`;
  if (action === 'stop' || action === 'restart') {
    await execAsync(`launchctl bootout ${domain} ${plistPath}`, { timeout: 10000 }).catch(() => {});
    if (action === 'stop') return;
    await new Promise(r => setTimeout(r, 800));
  }
  await execAsync(`launchctl bootstrap ${domain} ${plistPath}`, { timeout: 10000 });
}

function launchAgentPlistPath(label: string): string {
  const home = process.env.HOME ?? `/Users/${process.env.USER}`;
  return `${home}/Library/LaunchAgents/${label}.plist`;
}

// ---- macOS: brew services ----

async function brewCheck(name: string): Promise<{ status: 'running' | 'stopped' | 'error' } | null> {
  try {
    const { stdout } = await execAsync(`brew services info ${name} --json`, { timeout: 5000 });
    const info = JSON.parse(stdout);
    // brew services info returns an array
    const svc = Array.isArray(info) ? info[0] : info;
    if (!svc) return null;
    if (svc.status === 'started') return { status: 'running' };
    if (svc.status === 'stopped' || svc.status === 'none') return { status: 'stopped' };
    return { status: 'error' };
  } catch {
    return null;
  }
}

async function brewManage(name: string, action: 'start' | 'stop' | 'restart'): Promise<void> {
  await execAsync(`brew services ${action} ${name}`, { timeout: 15000 });
}

// ---- fallback: script-based ----

async function scriptManage(svc: ServiceConfig, action: 'start' | 'stop' | 'restart'): Promise<void> {
  if (action === 'stop' || action === 'restart') {
    if (!svc.stopScript) throw new Error(`No stopScript for ${svc.name}`);
    await execAsync(svc.stopScript, { timeout: 10000 });
  }
  if (action === 'start' || action === 'restart') {
    if (!svc.startScript) throw new Error(`No startScript for ${svc.name}`);
    // run detached so it survives the exec
    exec(`nohup sh -c ${JSON.stringify(svc.startScript)} &>/dev/null &`);
  }
}

// ---- log file tail ----

async function tailLogFile(path: string, lines: number): Promise<LogLine[]> {
  try {
    const { stdout } = await execAsync(`tail -n ${lines} ${JSON.stringify(path)}`, { timeout: 5000 });
    return stdout.split('\n').filter(l => l.trim()).map(line => ({
      level: parseLogLevel(line),
      text: line,
    }));
  } catch {
    return [];
  }
}

function parseLogLevel(line: string): 'info' | 'warn' | 'error' {
  const lower = line.toLowerCase();
  if (lower.includes('error') || lower.includes('fatal') || lower.includes('crit')) return 'error';
  if (lower.includes('warn') || lower.includes('warning')) return 'warn';
  return 'info';
}

// ---- public API ----

export async function checkService(svc: ServiceConfig): Promise<ServiceStatus> {
  const checkUrl = resolveIp(svc.checkUrl); // 解析 {LAN_IP} 占位符
  let status: 'running' | 'stopped' | 'error' = 'error';
  let latencyMs = 0;
  let startedAt: number | undefined;

  if (IS_LINUX && svc.systemd) {
    // Linux: systemd is authoritative for status; HTTP measures latency
    const sd = await systemdCheck(svc.systemd);
    if (sd) { status = sd.status; startedAt = sd.startedAt; }
    if (status === 'running') {
      const http = await httpProbe(checkUrl);
      latencyMs = http.latencyMs;
    }
  } else if (IS_MACOS && svc.launchAgent) {
    // macOS LaunchAgent: launchctl is the sole authority for status.
    // If the label is absent from launchctl (null), the service is definitively
    // stopped — do NOT fall back to HTTP, which may still see the port open
    // while the process is mid-shutdown and incorrectly return 'error'.
    const lc = await launchctlCheck(svc.launchAgent);
    status = lc ? lc.status : 'stopped';
    if (status === 'running') {
      const http = await httpProbe(checkUrl);
      if (http.status === 'running') latencyMs = http.latencyMs;
    }
  } else if (IS_MACOS && svc.brewService) {
    // macOS brew services: authoritative for status
    const br = await brewCheck(svc.brewService);
    if (br) {
      status = br.status;
    } else {
      const http = await httpProbe(checkUrl);
      status = http.status;
      latencyMs = http.latencyMs;
    }
    if (status === 'running') {
      const http = await httpProbe(checkUrl);
      if (http.status === 'running') latencyMs = http.latencyMs;
    }
  } else {
    // No process manager configured: HTTP only
    const http = await httpProbe(checkUrl);
    status = http.status;
    latencyMs = http.latencyMs;
  }

  const result: ServiceStatus = {
    id: svc.id,
    status,
    latencyMs,
    checkedAt: Date.now(),
    startedAt,
  };
  insertServiceCheck(svc.id, status, result.latencyMs || null);
  return result;
}

export async function checkAllServices(): Promise<ServiceStatus[]> {
  const results = await Promise.allSettled(SERVICES.map(svc => checkService(svc)));
  return results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    return { id: SERVICES[i].id, status: 'error' as const, latencyMs: 0, checkedAt: Date.now() };
  });
}

export async function manageService(svc: ServiceConfig, action: 'start' | 'stop' | 'restart'): Promise<void> {
  if (IS_LINUX && svc.systemd) {
    return systemdManage(svc.systemd, action);
  }
  if (IS_MACOS && svc.launchAgent) {
    return launchctlManage(svc.launchAgent, launchAgentPlistPath(svc.launchAgent), action);
  }
  if (IS_MACOS && svc.brewService) {
    return brewManage(svc.brewService, action);
  }
  if (svc.startScript || svc.stopScript) {
    return scriptManage(svc, action);
  }
  throw new Error(`${svc.name} 未配置服务管理方式（launchAgent / brewService / systemd / startScript）`);
}

export async function getServiceLogs(svc: ServiceConfig, lines: number, filePath?: string): Promise<LogLine[]> {
  // If a specific file is requested (e.g. access.log vs error.log), use it directly
  if (filePath) {
    return tailLogFile(filePath, lines);
  }
  // Single logFile field
  if (svc.logFile) {
    return tailLogFile(svc.logFile, lines);
  }
  // Multi-log array: default to first entry
  if (svc.logs && svc.logs.length > 0) {
    return tailLogFile(svc.logs[0].file, lines);
  }
  if (IS_LINUX && svc.systemd) {
    return systemdLogs(svc.systemd, lines);
  }
  if (IS_MACOS && svc.brewService) {
    const home = process.env.HOME ?? '/Users/' + process.env.USER;
    return tailLogFile(`${home}/Library/Logs/Homebrew/${svc.brewService}/${svc.brewService}.log`, lines);
  }
  return [];
}
