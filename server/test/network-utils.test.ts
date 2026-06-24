import test from 'node:test';
import assert from 'node:assert/strict';
import { latestProbedAt } from '../src/routes/network-utils.js';

test('latestProbedAt handles large probe sets without overflowing the call stack', () => {
  const fallback = 1000;
  const probes = Array.from({ length: 200_000 }, (_, i) => ({ probed_at: fallback + i }));

  assert.equal(latestProbedAt(probes, fallback), fallback + probes.length - 1);
});

test('latestProbedAt returns fallback when there are no probes', () => {
  assert.equal(latestProbedAt([], 1234), 1234);
});
