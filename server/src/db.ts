import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '../../data.db');

export const db = new Database(DB_PATH);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS service_checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_id TEXT NOT NULL,
    status TEXT NOT NULL,
    latency_ms INTEGER,
    checked_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS net_probes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dest_id TEXT NOT NULL,
    path TEXT NOT NULL,
    up INTEGER NOT NULL,
    latency_ms INTEGER,
    probed_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_id TEXT,
    color TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS net_group_stats (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    group_key      TEXT    NOT NULL,   -- 'domestic' | 'international'
    avg_latency_ms INTEGER,            -- NULL 表示当次全部不可达
    computed_at    INTEGER NOT NULL
  );
`);

// Create indexes for performance
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_service_checks_service_id ON service_checks(service_id);
  CREATE INDEX IF NOT EXISTS idx_service_checks_checked_at ON service_checks(checked_at);
  CREATE INDEX IF NOT EXISTS idx_net_probes_probed_at ON net_probes(probed_at);
  CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
  CREATE INDEX IF NOT EXISTS idx_net_group_stats_key_at ON net_group_stats(group_key, computed_at);
`);

// Auto-cleanup: delete records older than 30 days
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const cutoff = Date.now() - THIRTY_DAYS_MS;
db.prepare('DELETE FROM service_checks WHERE checked_at < ?').run(cutoff);
db.prepare('DELETE FROM net_probes WHERE probed_at < ?').run(cutoff);
db.prepare('DELETE FROM net_group_stats WHERE computed_at < ?').run(cutoff);

// ---- Typed query functions ----

export interface ServiceCheck {
  id: number;
  service_id: string;
  status: string;
  latency_ms: number | null;
  checked_at: number;
}

export interface NetProbe {
  id: number;
  dest_id: string;
  path: string;
  up: number;
  latency_ms: number | null;
  probed_at: number;
}

export interface EventRow {
  id: number;
  service_id: string | null;
  color: string;
  message: string;
  created_at: number;
}

const stmtInsertServiceCheck = db.prepare(
  'INSERT INTO service_checks (service_id, status, latency_ms, checked_at) VALUES (?, ?, ?, ?)'
);

const stmtGetServiceChecks = db.prepare(
  'SELECT * FROM service_checks WHERE service_id = ? AND checked_at >= ? ORDER BY checked_at DESC'
);

const stmtInsertNetProbe = db.prepare(
  'INSERT INTO net_probes (dest_id, path, up, latency_ms, probed_at) VALUES (?, ?, ?, ?, ?)'
);

const stmtGetNetProbes = db.prepare(
  'SELECT * FROM net_probes WHERE path = ? AND probed_at >= ? ORDER BY probed_at ASC'
);

const stmtInsertEvent = db.prepare(
  'INSERT INTO events (service_id, color, message, created_at) VALUES (?, ?, ?, ?)'
);

const stmtGetEvents = db.prepare(
  'SELECT * FROM events ORDER BY created_at DESC LIMIT ?'
);

export function insertServiceCheck(serviceId: string, status: string, latencyMs: number | null): void {
  stmtInsertServiceCheck.run(serviceId, status, latencyMs, Date.now());
}

export function getServiceChecks(serviceId: string, sinceMs: number): ServiceCheck[] {
  return stmtGetServiceChecks.all(serviceId, sinceMs) as ServiceCheck[];
}

export function insertNetProbe(destId: string, path: string, up: boolean, latencyMs: number | null): void {
  stmtInsertNetProbe.run(destId, path, up ? 1 : 0, latencyMs, Date.now());
}

export function getNetProbes(path: string, sinceMs: number): NetProbe[] {
  return stmtGetNetProbes.all(path, sinceMs) as NetProbe[];
}

export function insertEvent(serviceId: string | null, color: string, message: string): void {
  stmtInsertEvent.run(serviceId, color, message, Date.now());
}

export function getEvents(limit: number): EventRow[] {
  return stmtGetEvents.all(limit) as EventRow[];
}

// ---- Net group stats ----

export interface GroupStat {
  avg_latency_ms: number | null;
  computed_at: number;
}

export function insertGroupStat(groupKey: string, avgLatencyMs: number | null): void {
  db.prepare('INSERT INTO net_group_stats (group_key, avg_latency_ms, computed_at) VALUES (?, ?, ?)')
    .run(groupKey, avgLatencyMs, Date.now());
}

export function getGroupStats(groupKey: string, sinceMs: number): GroupStat[] {
  return db.prepare(
    'SELECT avg_latency_ms, computed_at FROM net_group_stats WHERE group_key = ? AND computed_at >= ? ORDER BY computed_at ASC'
  ).all(groupKey, sinceMs) as GroupStat[];
}

// ---- Settings ----

export function getSetting(key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}
