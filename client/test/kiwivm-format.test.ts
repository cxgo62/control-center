import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatShanghaiResetTime,
  formatTrafficBytes,
  formatUsagePercent,
} from '../src/components/kiwivm-format.js';

test('KiwiVM formats transfer values with IEC units', () => {
  const GiB = 1024 ** 3;
  const TiB = 1024 ** 4;

  assert.equal(formatTrafficBytes(0), '0.00 GiB');
  assert.equal(formatTrafficBytes(102.31 * GiB), '102.31 GiB');
  assert.equal(formatTrafficBytes(TiB - 1), '1024.00 GiB');
  assert.equal(formatTrafficBytes(TiB), '1.00 TiB');
  assert.equal(formatTrafficBytes(2 * TiB), '2.00 TiB');
});

test('KiwiVM formats usage percentage to two decimals', () => {
  assert.equal(formatUsagePercent(0), '0.00%');
  assert.equal(formatUsagePercent(20.456), '20.46%');
  assert.equal(formatUsagePercent(120), '120.00%');
});

test('KiwiVM preserves threshold-edge precision when rounding would contradict severity', () => {
  assert.equal(formatUsagePercent(69.999), '69.999%');
  assert.equal(formatUsagePercent(70), '70.00%');
  assert.equal(formatUsagePercent(84.999), '84.999%');
  assert.equal(formatUsagePercent(85), '85.00%');
  assert.equal(formatUsagePercent(94.999), '94.999%');
  assert.equal(formatUsagePercent(95), '95.00%');
});

test('KiwiVM formats reset time in Asia Shanghai explicitly', () => {
  assert.equal(
    formatShanghaiResetTime(Date.UTC(2026, 8, 3, 0, 0, 0)),
    '2026-09-03 08:00:00 Asia/Shanghai',
  );
});
