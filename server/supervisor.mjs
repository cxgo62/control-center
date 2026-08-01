import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function writeLog(level, event, fields = {}) {
  process.stdout.write(`${JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    component: 'control-center-supervisor',
    event,
    ...fields,
  })}\n`);
}

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();

  return new Promise(resolve => {
    child.once('exit', resolve);
  });
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;

  child.kill('SIGTERM');
  const forceKill = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }, 1_000);
  forceKill.unref();

  await waitForExit(child);
  clearTimeout(forceKill);
}

export async function superviseChildren(specs, options = {}) {
  const log = options.log ?? writeLog;
  const children = specs.map(spec => {
    const child = spawn(spec.command, spec.args ?? [], {
      cwd: spec.cwd,
      env: spec.env ?? process.env,
      stdio: spec.stdio ?? 'inherit',
    });
    options.onSpawn?.(spec.name, child);
    log('info', 'child_started', { child: spec.name, pid: child.pid });
    return { spec, child };
  });

  let resolveShutdown;
  const requestedShutdown = new Promise(resolve => {
    resolveShutdown = resolve;
  });
  const handleSigint = () => resolveShutdown({ name: 'supervisor', code: null, signal: 'SIGINT' });
  const handleSigterm = () => resolveShutdown({ name: 'supervisor', code: null, signal: 'SIGTERM' });
  process.once('SIGINT', handleSigint);
  process.once('SIGTERM', handleSigterm);

  const exits = children.map(({ spec, child }) => new Promise(resolve => {
    child.once('error', error => {
      resolve({ name: spec.name, code: null, signal: null, error });
    });
    child.once('exit', (code, signal) => {
      resolve({ name: spec.name, code, signal });
    });
  }));

  const result = await Promise.race([...exits, requestedShutdown]);
  process.removeListener('SIGINT', handleSigint);
  process.removeListener('SIGTERM', handleSigterm);

  log(result.error ? 'error' : 'warn', 'child_exit', {
    child: result.name,
    code: result.code,
    signal: result.signal,
    error: result.error?.message,
  });

  await Promise.all(children
    .filter(({ spec }) => spec.name !== result.name)
    .map(({ child }) => stopChild(child)));

  return result;
}

const isEntrypoint = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  const serverDir = path.dirname(fileURLToPath(import.meta.url));
  const rootDir = path.dirname(serverDir);
  const result = await superviseChildren([
    {
      name: 'server',
      command: path.join(serverDir, 'node_modules/.bin/tsx'),
      args: ['src/index.ts'],
      cwd: serverDir,
    },
    {
      name: 'client',
      command: path.join(rootDir, 'client/node_modules/.bin/vite'),
      cwd: path.join(rootDir, 'client'),
    },
  ]);

  process.exitCode = result.code && result.code !== 0 ? result.code : 1;
}
