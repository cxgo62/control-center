import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ISTOREOS_REMOTE_COMMAND,
  buildIStoreOSSshArgs,
  createIStoreOSMonitor,
  parseIStoreOSProbeOutput,
  type IStoreOSExec,
} from '../src/istoreos-monitor.js';

const healthyOutput = 'xray=1\nproxy=204 0.123\n';

function executorFor(output: string, calls: Array<readonly string[]> = []): IStoreOSExec {
  return async args => {
    calls.push(args);
    return { stdout: output, stderr: 'private-key-like stderr must not escape' };
  };
}

test('parses only the allowlisted Xray and SOCKS proxy fields', () => {
  assert.deepEqual(parseIStoreOSProbeOutput(healthyOutput), {
    xrayOk: true,
    proxyOk: true,
    proxyLatencyMs: 123,
  });
  assert.deepEqual(parseIStoreOSProbeOutput('xray=0\nproxy=503 0.500\n'), {
    xrayOk: false,
    proxyOk: false,
    proxyLatencyMs: 500,
  });
  assert.equal(parseIStoreOSProbeOutput('vless://secret\n'), null);
});

test('builds a fixed SSH command with safe identity and timeout options', () => {
  const args = buildIStoreOSSshArgs();
  assert.deepEqual(args.slice(0, 10), [
    '-i', '/Users/cx/.ssh/id_ed25519',
    '-p', '22',
    '-o', 'IdentitiesOnly=yes',
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=5',
  ]);
  assert.equal(args.at(-2), 'root@192.168.31.10');
  assert.equal(args.at(-1), ISTOREOS_REMOTE_COMMAND);
  assert.equal(args.includes('StrictHostKeyChecking=no'), false);
  assert.match(ISTOREOS_REMOTE_COMMAND, /--noproxy ''/);
  assert.match(ISTOREOS_REMOTE_COMMAND, /--proxy socks5h:\/\/127\.0\.0\.1:1070/);
  assert.match(ISTOREOS_REMOTE_COMMAND, /--connect-timeout 8/);
  assert.match(ISTOREOS_REMOTE_COMMAND, /--max-time 15/);
});

test('maps a healthy probe to running with proxy latency', async () => {
  const persisted: Array<[string, string, number | null]> = [];
  const monitor = createIStoreOSMonitor({
    execFile: executorFor(healthyOutput),
    persist: (...entry) => persisted.push(entry),
    now: () => 1_700_000_000_000,
  });

  assert.equal(monitor.getLatest().state, 'checking');
  const result = await monitor.probe();

  assert.deepEqual(result, {
    state: 'healthy',
    status: 'running',
    sshOk: true,
    xrayOk: true,
    proxyOk: true,
    proxyLatencyMs: 123,
    checkedAt: 1_700_000_000_000,
    latencyMs: 123,
  });
  assert.deepEqual(persisted, [['istoreos-router', 'running', 123]]);
});

test('maps a live router with a broken proxy to proxy_error', async () => {
  const monitor = createIStoreOSMonitor({
    execFile: executorFor('xray=0\nproxy=000 0\n'),
    persist: () => undefined,
  });

  const result = await monitor.probe();

  assert.equal(result.state, 'proxy_error');
  assert.equal(result.status, 'error');
  assert.equal(result.sshOk, true);
  assert.equal(result.xrayOk, false);
  assert.equal(result.proxyOk, false);
});

test('maps SSH failures to offline without exposing child-process diagnostics', async () => {
  const monitor = createIStoreOSMonitor({
    execFile: async () => { throw new Error('ssh secret-endpoint vless://credential'); },
    persist: () => undefined,
  });

  const result = await monitor.probe();

  assert.deepEqual(result, {
    state: 'offline',
    status: 'stopped',
    sshOk: false,
    xrayOk: null,
    proxyOk: null,
    proxyLatencyMs: null,
    checkedAt: result.checkedAt,
    latencyMs: 0,
  });
  assert.equal(JSON.stringify(result).includes('secret-endpoint'), false);
  assert.equal(JSON.stringify(result).includes('vless://'), false);
});

test('coalesces concurrent probes into one in-flight SSH operation', async () => {
  let resolveExec: ((value: { stdout: string; stderr: string }) => void) | undefined;
  let calls = 0;
  const execFile: IStoreOSExec = async () => {
    calls += 1;
    return new Promise(resolve => { resolveExec = resolve; });
  };
  const monitor = createIStoreOSMonitor({ execFile, persist: () => undefined });

  const first = monitor.probe();
  const second = monitor.probe();
  assert.equal(calls, 1);
  resolveExec!({ stdout: healthyOutput, stderr: '' });

  const [one, two] = await Promise.all([first, second]);
  assert.deepEqual(one, two);
});
