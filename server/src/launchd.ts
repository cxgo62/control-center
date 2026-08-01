import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export type LaunchdStatus = 'running' | 'stopped';
export type LaunchdAction = 'start' | 'stop' | 'restart';
export type LaunchdExec = (command: string, options: { timeout: number }) => Promise<unknown>;

export function buildLaunchdTarget(label: string, uid: number): string {
  return `gui/${uid}/${label}`;
}

export function parseLaunchdPrint(output: string): LaunchdStatus {
  return /^\s*state\s*=\s*running\s*$/m.test(output) ? 'running' : 'stopped';
}

export async function checkLaunchAgent(options: {
  label: string;
  uid: number;
  exec?: LaunchdExec;
}): Promise<LaunchdStatus | null> {
  const run = options.exec ?? execAsync;
  try {
    const result = await run(
      `launchctl print ${buildLaunchdTarget(options.label, options.uid)}`,
      { timeout: 3_000 },
    ) as { stdout?: string };
    return parseLaunchdPrint(result.stdout ?? '');
  } catch {
    return null;
  }
}

export async function manageLaunchAgent(options: {
  label: string;
  plistPath: string;
  action: LaunchdAction;
  uid: number;
  exec?: LaunchdExec;
}): Promise<void> {
  const run = options.exec ?? execAsync;
  const domain = `gui/${options.uid}`;
  if (options.action === 'restart') {
    await run(`launchctl kickstart -k ${buildLaunchdTarget(options.label, options.uid)}`, { timeout: 10_000 });
    return;
  }
  if (options.action === 'stop') {
    await run(`launchctl bootout ${domain} ${options.plistPath}`, { timeout: 10_000 });
    return;
  }
  await run(`launchctl bootstrap ${domain} ${options.plistPath}`, { timeout: 10_000 });
}
