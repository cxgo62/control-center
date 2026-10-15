import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import Database from 'better-sqlite3';

test('service history uses both service and time to bound reads without sorting', () => {
  const source = readFileSync(new URL('../src/db.ts', import.meta.url), 'utf8');
  const schema = [...source.matchAll(/db\.exec\(`([\s\S]*?)`\);/g)];
  const database = new Database(':memory:');
  try {
    for (const match of schema) database.exec(match[1]);
    const plan = database.prepare(`
      EXPLAIN QUERY PLAN SELECT * FROM service_checks
      WHERE service_id = ? AND checked_at >= ? ORDER BY checked_at DESC
    `).all('example', Date.now() - 86_400_000) as { detail: string }[];
    const details = plan.map(row => row.detail).join('\n');
    assert.match(details, /service_id=\? AND checked_at>\?/);
    assert.doesNotMatch(details, /TEMP B-TREE|SCAN service_checks/);
  } finally {
    database.close();
  }
});
