import assert from 'node:assert/strict';
import test from 'node:test';
import { SERVICES } from '../src/config.js';

test('registers the Phenology backup worker as a monitored personal app', () => {
  const service = SERVICES.find(candidate => candidate.id === 'phenology-backup');
  assert.deepEqual(service, {
    id: 'phenology-backup',
    name: 'Phenology Backup / Codex Worker',
    group: 'app',
    tech: '备份节点 · 本地 Codex Worker',
    checkUrl: 'http://127.0.0.1:5178/api/system/runtime-status',
    port: ':5178',
    addr: '127.0.0.1:5178',
    url: 'http://127.0.0.1:5178',
    launchAgent: 'top.damkeeper.phenology-backup',
    health: {
      timeoutMs: 5_000,
      expect: {
        httpStatus: 200,
        json: {
          runtimeRole: 'backup',
          readOnly: true,
          codex: { provider: 'local', status: 'available' },
        },
      },
    },
    logs: [
      { label: '标准输出', file: '/Users/cx/cx/phenology-backup/.prod/logs/launchd.out.log', glyph: '≡', tone: 'mute' },
      { label: '标准错误', file: '/Users/cx/cx/phenology-backup/.prod/logs/launchd.err.log', glyph: '⚠', tone: 'danger' },
    ],
  });
});

test('registers the primary SSH tunnel as monitored network infrastructure', () => {
  const service = SERVICES.find(candidate => candidate.id === 'phenology-primary-tunnel');
  assert.deepEqual(service, {
    id: 'phenology-primary-tunnel',
    name: 'Phenology Primary Tunnel',
    group: 'infra',
    tech: '双向 SSH 隧道 · 主备互联',
    checkUrl: 'http://127.0.0.1:15177/api/system/runtime-status',
    port: ':15177 / :15178',
    addr: '127.0.0.1:15177',
    launchAgent: 'top.damkeeper.phenology-primary-tunnel',
    health: {
      timeoutMs: 5_000,
      expect: {
        httpStatus: 200,
        json: {
          runtimeRole: 'primary',
          readOnly: false,
          codex: { provider: 'rpc', status: 'available' },
        },
      },
    },
    logs: [
      { label: '标准输出', file: '/Users/cx/cx/phenology-backup/.prod/logs/tunnel.out.log', glyph: '≡', tone: 'mute' },
      { label: '标准错误', file: '/Users/cx/cx/phenology-backup/.prod/logs/tunnel.err.log', glyph: '⚠', tone: 'danger' },
    ],
  });
});
