import test from 'node:test';
import assert from 'node:assert/strict';
import { parseClashVergeConfig, unavailableClashStatus } from '../src/routes/clash-status.js';

test('Clash Verge parser returns only the allowed status fields', () => {
  assert.deepEqual(parseClashVergeConfig(`
mixed-port: 7897
mode: rule
secret: do-not-return
tun:
  stack: gvisor
  enable: true
proxies:
  - name: private-node
`), {
    available: true,
    mixedPort: 7897,
    mode: 'rule',
    tunEnabled: true,
    tunStack: 'gvisor',
  });
});

test('Clash Verge parser accepts quoted scalar values', () => {
  assert.deepEqual(parseClashVergeConfig(`
mixed-port: 7897
mode: "global"
tun:
  enable: false
  stack: "system"
`), {
    available: true,
    mixedPort: 7897,
    mode: 'global',
    tunEnabled: false,
    tunStack: 'system',
  });
});

test('Clash Verge parser rejects missing or invalid required fields safely', () => {
  const invalidConfigs = [
    'mode: rule\ntun:\n  enable: true\n  stack: gvisor\n',
    'mixed-port: 0\nmode: rule\ntun:\n  enable: true\n  stack: gvisor\n',
    'mixed-port: 65536\nmode: rule\ntun:\n  enable: true\n  stack: gvisor\n',
    'mixed-port: 7897\nmode: ""\ntun:\n  enable: true\n  stack: gvisor\n',
    'mixed-port: 7897\nmode: rule\ntun:\n  stack: gvisor\n',
    'mixed-port: 7897\nmode: rule\ntun:\n  enable: true\n',
  ];

  for (const config of invalidConfigs) {
    assert.deepEqual(parseClashVergeConfig(config), unavailableClashStatus);
  }
  assert.equal(JSON.stringify(unavailableClashStatus).includes('7897'), false);
});
