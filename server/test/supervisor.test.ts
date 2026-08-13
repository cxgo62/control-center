import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createSupervisorSpecs, superviseChildren } from '../supervisor.mjs';

test('starts the launchd Vite child with the control-center public base', () => {
  const specs = createSupervisorSpecs('/tmp/control-center', { EXISTING: 'preserved' });
  const client = specs.find(spec => spec.name === 'client');

  assert.ok(client);
  assert.equal(client.env.EXISTING, 'preserved');
  assert.equal(client.env.CONTROL_CENTER_PUBLIC_BASE_PATH, '/control-center/');
});

test('stops the surviving child when either managed process exits', async () => {
  const spawned: Array<{ name: string; pid: number }> = [];
  const startedAt = Date.now();

  const result = await superviseChildren([
    {
      name: 'server',
      command: process.execPath,
      args: ['-e', 'setTimeout(() => process.exit(23), 50)'],
    },
    {
      name: 'client',
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
    },
  ], {
    log: () => {},
    onSpawn: (name, child) => spawned.push({ name, pid: child.pid! }),
  });

  assert.equal(result.name, 'server');
  assert.equal(result.code, 23);
  assert.ok(Date.now() - startedAt < 2_000, 'supervisor should not wait for the surviving child');

  const client = spawned.find(child => child.name === 'client');
  assert.ok(client);
  assert.throws(() => process.kill(client.pid, 0));
});
