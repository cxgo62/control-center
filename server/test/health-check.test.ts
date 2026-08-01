import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import test from 'node:test';
import { matchesJsonExpectation, probeHttpHealth } from '../src/health-check.js';

async function listen(handler: Parameters<typeof createServer>[0]): Promise<{ server: Server; url: string }> {
  const server = createServer(handler);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return { server, url: `http://127.0.0.1:${address.port}` };
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

test('matches recursively nested expected JSON while ignoring extra fields', () => {
  assert.equal(matchesJsonExpectation(
    { runtimeRole: 'backup', readOnly: true, codex: { provider: 'local', status: 'available', version: 'x' } },
    { runtimeRole: 'backup', readOnly: true, codex: { provider: 'local', status: 'available' } },
  ), true);
  assert.equal(matchesJsonExpectation(
    { runtimeRole: 'backup', codex: { provider: 'rpc' } },
    { runtimeRole: 'backup', codex: { provider: 'local' } },
  ), false);
  assert.equal(matchesJsonExpectation(
    { runtimeRole: 'backup' },
    { runtimeRole: 'backup', codex: { provider: 'local' } },
  ), false);
});

test('accepts only the expected status and nested runtime body', async t => {
  const { server, url } = await listen((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ runtimeRole: 'backup', readOnly: true, codex: { provider: 'local', status: 'available' }, extra: 1 }));
  });
  t.after(() => close(server));

  const result = await probeHttpHealth(url, {
    timeoutMs: 500,
    expect: { httpStatus: 200, json: { runtimeRole: 'backup', readOnly: true, codex: { provider: 'local', status: 'available' } } },
  });
  assert.equal(result.status, 'running');
  assert.ok(result.latencyMs > 0);
});

test('reports error for wrong status, invalid JSON, mismatched JSON, timeout, and connection failure', async t => {
  const cases = [
    { status: 503, body: '{}' },
    { status: 200, body: 'not-json' },
    { status: 200, body: JSON.stringify({ runtimeRole: 'primary' }) },
  ];
  for (const item of cases) {
    const { server, url } = await listen((_request, response) => {
      response.writeHead(item.status, { 'content-type': 'application/json' });
      response.end(item.body);
    });
    const result = await probeHttpHealth(url, {
      timeoutMs: 100,
      expect: { httpStatus: 200, json: { runtimeRole: 'backup' } },
    });
    assert.equal(result.status, 'error');
    assert.ok(result.latencyMs > 0);
    await close(server);
  }

  const slow = await listen((_request, response) => setTimeout(() => response.end('{}'), 200));
  t.after(() => close(slow.server));
  assert.equal((await probeHttpHealth(slow.url, { timeoutMs: 10, expect: { httpStatus: 200 } })).status, 'error');
  const refused = await listen(() => {});
  await close(refused.server);
  assert.equal((await probeHttpHealth(refused.url, { timeoutMs: 50, expect: { httpStatus: 200 } })).status, 'stopped');
});
