import test from 'node:test';
import assert from 'node:assert/strict';
import { isoUtcTimestamp } from '../src/logger.js';

test('backend logger emits an ISO 8601 UTC timestamp fragment', () => {
  assert.equal(
    isoUtcTimestamp(new Date('2026-08-13T15:30:00.123Z')),
    ',"time":"2026-08-13T15:30:00.123Z"',
  );
});
