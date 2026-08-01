import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLaunchdTarget, parseLaunchdPrint, checkLaunchAgent, manageLaunchAgent } from '../src/launchd.js';

test('builds the gui launchd target and recognizes running print output', () => {
  assert.equal(buildLaunchdTarget('top.damkeeper.phenology-backup', 501), 'gui/501/top.damkeeper.phenology-backup');
  assert.equal(parseLaunchdPrint('state = running\npid = 123'), 'running');
  assert.equal(parseLaunchdPrint('state = waiting'), 'stopped');
});

test('restarts a launchd job with kickstart -k without bootout', async () => {
  const commands: string[] = [];
  await manageLaunchAgent({
    label: 'top.damkeeper.phenology-primary-tunnel',
    plistPath: '/Users/cx/Library/LaunchAgents/top.damkeeper.phenology-primary-tunnel.plist',
    action: 'restart',
    uid: 501,
    exec: async command => { commands.push(command); },
  });
  assert.deepEqual(commands, [
    'launchctl kickstart -k gui/501/top.damkeeper.phenology-primary-tunnel',
  ]);
});

test('checks launchd state with print and maps a missing job to null', async () => {
  const commands: string[] = [];
  const running = await checkLaunchAgent({
    label: 'top.damkeeper.phenology-backup',
    uid: 501,
    exec: async command => {
      commands.push(command);
      return { stdout: 'state = running\npid = 123' };
    },
  });
  assert.equal(running, 'running');
  assert.deepEqual(commands, ['launchctl print gui/501/top.damkeeper.phenology-backup']);

  const absent = await checkLaunchAgent({
    label: 'missing',
    uid: 501,
    exec: async () => { throw new Error('not found'); },
  });
  assert.equal(absent, null);
});

test('preserves bootstrap start and bootout stop commands', async () => {
  const commands: string[] = [];
  const base = {
    label: 'top.damkeeper.phenology-backup',
    plistPath: '/Users/cx/Library/LaunchAgents/top.damkeeper.phenology-backup.plist',
    uid: 501,
    exec: async (command: string) => { commands.push(command); },
  };
  await manageLaunchAgent({ ...base, action: 'start' });
  await manageLaunchAgent({ ...base, action: 'stop' });
  assert.deepEqual(commands, [
    'launchctl bootstrap gui/501 /Users/cx/Library/LaunchAgents/top.damkeeper.phenology-backup.plist',
    'launchctl bootout gui/501 /Users/cx/Library/LaunchAgents/top.damkeeper.phenology-backup.plist',
  ]);
});
