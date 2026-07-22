import test from 'node:test';
import assert from 'node:assert/strict';
import { bucketIndexAtOffset, cardHoverPosition, formatBucketTooltip } from '../src/components/uptime-bar-tooltip.js';

test('maps bar offsets to the first, middle, and final buckets', () => {
  assert.equal(bucketIndexAtOffset(0, 240, 48), 0);
  assert.equal(bucketIndexAtOffset(120, 240, 48), 24);
  assert.equal(bucketIndexAtOffset(240, 240, 48), 47);
});

test('maps full-card hover positions through the card content bounds', () => {
  assert.deepEqual(cardHoverPosition(0, 300, 10, 48), { index: 0, x: 10 });
  assert.deepEqual(cardHoverPosition(150, 300, 10, 48), { index: 24, x: 150 });
  assert.deepEqual(cardHoverPosition(300, 300, 10, 48), { index: 47, x: 290 });
});

test('formats same-day uptime intervals and their states', () => {
  const now = new Date(2026, 6, 22, 23, 0, 0);
  const base = { startAt: new Date(2026, 6, 22, 8, 5, 4).getTime(), endAt: new Date(2026, 6, 22, 8, 6, 19).getTime(), latencyMs: 0 };

  assert.equal(formatBucketTooltip({ ...base, hasData: true, up: true }, now), '08:05:04–08:06:19 · 正常');
  assert.equal(formatBucketTooltip({ ...base, hasData: true, up: false }, now), '08:05:04–08:06:19 · 断线');
  assert.equal(formatBucketTooltip({ ...base, hasData: false, up: false }, now), '08:05:04–08:06:19 · 无数据');
});

test('formats cross-midnight intervals and rejects invalid timestamps', () => {
  const now = new Date(2026, 6, 22, 23, 0, 0);
  assert.equal(
    formatBucketTooltip({ startAt: new Date(2026, 6, 21, 23, 59, 30).getTime(), endAt: new Date(2026, 6, 22, 0, 0, 45).getTime(), hasData: true, up: true, latencyMs: 0 }, now),
    '2026-07-21 23:59:30–2026-07-22 00:00:45 · 正常',
  );
  assert.equal(formatBucketTooltip({ startAt: Number.NaN, endAt: 1, hasData: true, up: true, latencyMs: 0 }, now), null);
});
