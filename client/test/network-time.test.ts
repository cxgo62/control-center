import test from 'node:test';
import assert from 'node:assert/strict';
import { formatSamplingTime } from '../src/components/network-time.js';

const now = new Date(2026, 6, 22, 22, 6, 40);

test('formats a same-day sampling timestamp with 今天', () => {
  assert.equal(
    formatSamplingTime(new Date(2026, 6, 22, 8, 5, 4).getTime(), now),
    '采样时间 · 今天 08:05:04',
  );
});

test('formats an older sampling timestamp with its local date', () => {
  assert.equal(
    formatSamplingTime(new Date(2026, 6, 21, 8, 5, 4).getTime(), now),
    '采样时间 · 2026-07-21 08:05:04',
  );
});

test('omits missing and invalid sampling timestamps', () => {
  assert.equal(formatSamplingTime(null, now), null);
  assert.equal(formatSamplingTime(Number.NaN, now), null);
  assert.equal(formatSamplingTime(Number.POSITIVE_INFINITY, now), null);
});
