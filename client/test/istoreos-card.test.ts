import assert from 'node:assert/strict';
import test from 'node:test';
import type { IStoreOSServiceInfo, ServiceInfo } from '../src/types.js';
import {
  ISTOREOS_CARD_HEIGHT,
  getIStoreOSActionKeys,
  getIStoreOSCheckRows,
  getIStoreOSStatusMeta,
  isIStoreOSService,
} from '../src/components/istoreos-card.js';

function makeRouter(state: IStoreOSServiceInfo['monitor']['state']): IStoreOSServiceInfo {
  return {
    id: 'istoreos-router',
    name: 'iStoreOS 软路由',
    group: 'infra',
    tech: 'iStoreOS 21.02.3 · PassWall2 / Xray',
    status: state === 'healthy' ? 'running' : state === 'offline' ? 'stopped' : 'error',
    latencyMs: state === 'healthy' ? 123 : 0,
    port: 'SSH :22 · SOCKS :1070',
    addr: '192.168.31.10',
    url: 'http://192.168.31.10/',
    lastCheck: 1_700_000_000_000,
    checkedAt: 1_700_000_000_000,
    hist: [],
    statusHist: [],
    kind: 'istoreos',
    monitor: {
      state,
      status: state === 'healthy' ? 'running' : state === 'offline' ? 'stopped' : 'error',
      sshOk: state !== 'offline',
      xrayOk: state === 'healthy',
      proxyOk: state === 'healthy',
      proxyLatencyMs: state === 'healthy' ? 123 : null,
      checkedAt: 1_700_000_000_000,
      latencyMs: state === 'healthy' ? 123 : 0,
    },
  };
}

test('recognizes only the iStoreOS service discriminator', () => {
  const router = makeRouter('healthy');
  const ordinary = { ...router, kind: undefined, monitor: undefined } as unknown as ServiceInfo;
  assert.equal(isIStoreOSService(router), true);
  assert.equal(isIStoreOSService(ordinary), false);
});

test('maps checking and completed states to user-facing status labels', () => {
  assert.equal(getIStoreOSStatusMeta(makeRouter('checking')).label, '检查中');
  assert.equal(getIStoreOSStatusMeta(makeRouter('healthy')).label, '健康');
  assert.equal(getIStoreOSStatusMeta(makeRouter('proxy_error')).label, '代理异常');
  assert.equal(getIStoreOSStatusMeta(makeRouter('offline')).label, '离线');
});

test('builds the three current check rows and only read-only actions', () => {
  const rows = getIStoreOSCheckRows(makeRouter('healthy'));
  assert.deepEqual(rows.map(row => row.label), ['SSH', 'Xray', '代理链路']);
  assert.deepEqual(rows.map(row => row.ok), [true, true, true]);
  assert.deepEqual(getIStoreOSActionKeys(), ['probe', 'open']);
});

test('keeps the specialized card at the existing service-card height', () => {
  assert.equal(ISTOREOS_CARD_HEIGHT, 280);
});
