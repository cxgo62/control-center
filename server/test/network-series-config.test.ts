import assert from 'node:assert/strict';
import test from 'node:test';
import { NET_LATENCY_SERIES, validateNetLatencySeries } from '../src/config.js';

test('registers the initial latency series in display order', () => {
  assert.deepEqual(NET_LATENCY_SERIES, [
    { id: 'domestic', label: '国内', source: { kind: 'group', group: 'domestic', path: 'direct' }, color: '#22c55e', order: 10 },
    { id: 'international', label: '国际', source: { kind: 'group', group: 'international', path: 'proxy' }, color: '#a855f7', order: 20 },
    { id: 'chatgpt', label: 'ChatGPT', source: { kind: 'target', targetId: 'chatgpt', path: 'proxy' }, color: '#3b82f6', order: 30 },
    { id: 'google', label: 'Google', source: { kind: 'target', targetId: 'google', path: 'proxy' }, color: '#f59e0b', order: 40 },
  ]);
});

test('validator retains known group and target series while skipping invalid and duplicate entries', () => {
  const result = validateNetLatencySeries([
    { id: 'ok', label: 'OK', source: { kind: 'group', group: 'domestic', path: 'direct' }, color: '#123456', order: 2 },
    { id: 'ok', label: 'Duplicate', source: { kind: 'target', targetId: 'google', path: 'proxy' }, color: '#654321', order: 1 },
    { id: 'bad-group', label: 'Bad group', source: { kind: 'group', group: 'unknown', path: 'direct' }, color: '#123456', order: 3 },
    { id: 'bad-target', label: 'Bad target', source: { kind: 'target', targetId: 'missing', path: 'proxy' }, color: '#123456', order: 4 },
    { id: 'bad-path', label: 'Bad path', source: { kind: 'target', targetId: 'google', path: 'tunnel' }, color: '#123456', order: 5 },
    { id: 'bad-color', label: 'Bad color', source: { kind: 'target', targetId: 'google', path: 'proxy' }, color: '', order: 6 },
  ]);

  assert.deepEqual(result.series, [
    { id: 'ok', label: 'OK', source: { kind: 'group', group: 'domestic', path: 'direct' }, color: '#123456', order: 2 },
  ]);
  assert.deepEqual(result.warnings, [
    { id: 'ok', reason: 'duplicate-id' },
    { id: 'bad-group', reason: 'invalid-group' },
    { id: 'bad-target', reason: 'unknown-target' },
    { id: 'bad-path', reason: 'invalid-path' },
    { id: 'bad-color', reason: 'invalid-color' },
  ]);
});
