import assert from 'node:assert/strict';
import { test } from 'node:test';

import { superviseChildren } from '../supervisor.mjs';

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
