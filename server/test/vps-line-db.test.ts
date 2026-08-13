import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import * as dbModule from '../src/db.js';

type VpsLineDbModule = typeof dbModule & {
  initializeVpsLineSampleStorage: (database: Database.Database, nowMs?: number) => void;
  insertVpsLineSample: (sample: {
    probedAt: number;
    nodeName: string;
    sent: number;
    received: number;
    medianLatencyMs: number | null;
    p95LatencyMs: number | null;
    jitterMs: number | null;
    tcpState: 'up' | 'down';
    icmpUsable: boolean;
  }, database?: Database.Database) => void;
  getVpsLineSamples: (nodeName: string, sinceMs: number, database?: Database.Database) => Array<{
    id: number;
    probedAt: number;
    nodeName: string;
    sent: number;
    received: number;
    medianLatencyMs: number | null;
    p95LatencyMs: number | null;
    jitterMs: number | null;
    tcpState: 'up' | 'down';
    icmpUsable: boolean;
  }>;
};

const vpsDb = dbModule as VpsLineDbModule;

test('stores and queries typed VPS samples without resolved endpoint fields', () => {
  assert.equal(typeof vpsDb.initializeVpsLineSampleStorage, 'function');
  assert.equal(typeof vpsDb.insertVpsLineSample, 'function');
  assert.equal(typeof vpsDb.getVpsLineSamples, 'function');

  const database = new Database(':memory:');
  try {
    vpsDb.initializeVpsLineSampleStorage(database, 2_000_000_000_000);
    vpsDb.insertVpsLineSample({
      probedAt: 1_999_999_999_000,
      nodeName: 'configured-private-node',
      sent: 10,
      received: 8,
      medianLatencyMs: 123.5,
      p95LatencyMs: 220.25,
      jitterMs: 17.75,
      tcpState: 'up',
      icmpUsable: true,
    }, database);
    vpsDb.insertVpsLineSample({
      probedAt: 1_999_999_998_000,
      nodeName: 'other-node',
      sent: 10,
      received: 0,
      medianLatencyMs: null,
      p95LatencyMs: null,
      jitterMs: null,
      tcpState: 'down',
      icmpUsable: false,
    }, database);

    assert.deepEqual(vpsDb.getVpsLineSamples('configured-private-node', 1_999_999_000_000, database), [{
      id: 1,
      probedAt: 1_999_999_999_000,
      nodeName: 'configured-private-node',
      sent: 10,
      received: 8,
      medianLatencyMs: 123.5,
      p95LatencyMs: 220.25,
      jitterMs: 17.75,
      tcpState: 'up',
      icmpUsable: true,
    }]);

    const columns = database.prepare('PRAGMA table_info(vps_line_samples)').all() as Array<{ name: string }>;
    assert.deepEqual(columns.map(column => column.name), [
      'id',
      'probed_at',
      'node_name',
      'sent',
      'received',
      'median_latency_ms',
      'p95_latency_ms',
      'jitter_ms',
      'tcp_state',
      'icmp_usable',
    ]);
    assert.equal(columns.some(column => /host|port|address/i.test(column.name)), false);

    const indexes = database.prepare("PRAGMA index_list('vps_line_samples')").all() as Array<{ name: string }>;
    assert.equal(indexes.some(index => index.name === 'idx_vps_line_samples_probed_at'), true);
  } finally {
    database.close();
  }
});

test('startup initialization deletes VPS samples older than 30 days', () => {
  assert.equal(typeof vpsDb.initializeVpsLineSampleStorage, 'function');

  const database = new Database(':memory:');
  const now = 2_000_000_000_000;
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  try {
    vpsDb.initializeVpsLineSampleStorage(database, now);
    vpsDb.insertVpsLineSample({
      probedAt: now - thirtyDays - 1,
      nodeName: 'configured-private-node',
      sent: 10,
      received: 10,
      medianLatencyMs: 100,
      p95LatencyMs: 110,
      jitterMs: 5,
      tcpState: 'up',
      icmpUsable: true,
    }, database);
    vpsDb.insertVpsLineSample({
      probedAt: now - thirtyDays,
      nodeName: 'configured-private-node',
      sent: 10,
      received: 10,
      medianLatencyMs: 100,
      p95LatencyMs: 110,
      jitterMs: 5,
      tcpState: 'up',
      icmpUsable: true,
    }, database);

    vpsDb.initializeVpsLineSampleStorage(database, now);

    assert.deepEqual(
      vpsDb.getVpsLineSamples('configured-private-node', 0, database).map(sample => sample.probedAt),
      [now - thirtyDays],
    );
  } finally {
    database.close();
  }
});
