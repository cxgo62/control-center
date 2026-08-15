import assert from 'node:assert/strict';
import Fastify from 'fastify';
import test from 'node:test';
import servicesRoutes from '../src/routes/services.js';
import { createIStoreOSMonitor, type IStoreOSProbeResult } from '../src/istoreos-monitor.js';

function fakeResult(): IStoreOSProbeResult {
  return {
    state: 'healthy',
    status: 'running',
    sshOk: true,
    xrayOk: true,
    proxyOk: true,
    proxyLatencyMs: 42,
    checkedAt: 1_700_000_000_000,
    latencyMs: 42,
  };
}

test('rejects mutating actions for the iStoreOS service', async () => {
  const app = Fastify();
  let calls = 0;
  const monitor = {
    probe: async () => { calls += 1; return fakeResult(); },
    getLatest: () => fakeResult(),
    start: () => undefined,
    stop: () => undefined,
  };
  await app.register(servicesRoutes, { istoreosMonitor: monitor });

  for (const action of ['start', 'stop', 'restart']) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/services/istoreos-router/action',
      payload: { action },
    });
    assert.equal(response.statusCode, 400);
  }
  assert.equal(calls, 0);
  await app.close();
});

test('routes iStoreOS probe actions through the injected monitor', async () => {
  const app = Fastify();
  let calls = 0;
  const monitor = {
    probe: async () => { calls += 1; return fakeResult(); },
    getLatest: () => fakeResult(),
    start: () => undefined,
    stop: () => undefined,
  };
  await app.register(servicesRoutes, { istoreosMonitor: monitor });

  const response = await app.inject({
    method: 'POST',
    url: '/api/services/istoreos-router/action',
    payload: { action: 'probe' },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(calls, 1);
  const body = response.json();
  assert.equal(body.kind, 'istoreos');
  assert.equal(body.monitor.state, 'healthy');
  assert.equal(body.monitor.proxyLatencyMs, 42);
  await app.close();
});

test('the monitor scheduler can start immediately and stop without overlap', async () => {
  let calls = 0;
  const monitor = createIStoreOSMonitor({
    intervalMs: 5,
    execFile: async () => {
      calls += 1;
      await new Promise(resolve => setTimeout(resolve, 2));
      return { stdout: 'xray=1\nproxy=204 0.010\n', stderr: '' };
    },
    persist: () => undefined,
  });

  monitor.start();
  await new Promise(resolve => setTimeout(resolve, 18));
  monitor.stop();
  const afterStop = calls;
  await new Promise(resolve => setTimeout(resolve, 12));

  assert.ok(afterStop >= 2);
  assert.equal(calls, afterStop);
});
