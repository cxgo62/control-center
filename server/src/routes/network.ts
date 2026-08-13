import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import path from 'path';
import { NET_TARGETS } from '../config.js';
import { getNetProbes, getGroupStats, getSetting, setSetting, type NetProbe } from '../db.js';
import { probeAll, probeTarget, getActiveProxyUrl } from '../prober.js';
import { createLivePingEntry, latestProbedAt, latestProbeForTarget } from './network-utils.js';
import { parseClashVergeConfig, unavailableClashStatus } from './clash-status.js';

const NET_BUCKETS = 48;

interface BucketData {
  up: boolean;
  latencyMs: number;
  hasData: boolean; // false = 该时段内无探测记录，不代表断线
  startAt: number;
  endAt: number;
}

interface NetDestResponse {
  id: string;
  name: string;
  host: string;
  group: string;
  up: boolean;
  latencyMs: number;
  probedAt: number | null;
  avail: number;
  buckets: BucketData[];
}

export function buildBuckets(probes: NetProbe[], destId: string, sinceMs: number, nowMs: number): {
  buckets: BucketData[];
  up: boolean;
  latencyMs: number;
  probedAt: number | null;
  avail: number;
} {
  const bucketSize = (nowMs - sinceMs) / NET_BUCKETS;
  const destProbes = probes.filter(p => p.dest_id === destId);

  const buckets: BucketData[] = Array.from({ length: NET_BUCKETS }, (_, i) => {
    const bucketStart = sinceMs + i * bucketSize;
    const bucketEnd = bucketStart + bucketSize;
    const inBucket = destProbes.filter(p => p.probed_at >= bucketStart && p.probed_at < bucketEnd);

    if (inBucket.length === 0) {
      return { up: false, latencyMs: 0, hasData: false, startAt: bucketStart, endAt: bucketEnd }; // 无数据，不是断线
    }

    const upProbes = inBucket.filter(p => p.up === 1);
    if (upProbes.length === 0) {
      return { up: false, latencyMs: 0, hasData: true, startAt: bucketStart, endAt: bucketEnd }; // 有数据，真的断了
    }

    const avgLatency = Math.round(
      upProbes.reduce((sum, p) => sum + (p.latency_ms ?? 0), 0) / upProbes.length
    );
    return { up: true, latencyMs: avgLatency, hasData: true, startAt: bucketStart, endAt: bucketEnd };
  });

  // 可用率：只统计有实际数据的桶
  const withData = buckets.filter(b => b.hasData);
  const avail = withData.length > 0 ? (withData.filter(b => b.up).length / withData.length) * 100 : 0;

  // 当前状态：取最近一次实际探测，而非最后一个桶（桶可能是空的）
  const latestProbe = latestProbeForTarget(destProbes, destId);
  const currentUp = latestProbe ? latestProbe.up === 1 : false;
  const currentLatency = currentUp ? (latestProbe!.latency_ms ?? 0) : 0;

  return { buckets, up: currentUp, latencyMs: currentLatency, probedAt: latestProbe?.probed_at ?? null, avail };
}

export default async function networkRoutes(fastify: FastifyInstance) {
  // GET /api/network/data
  fastify.get<{ Querystring: { range?: string } }>('/api/network/data', async request => {
    const range = request.query.range ?? '1h';
    const now = Date.now();

    let sinceMs: number;
    switch (range) {
      case '6h':  sinceMs = now - 21600000; break;
      case '24h': sinceMs = now - 86400000; break;
      case '7d':  sinceMs = now - 604800000; break;
      case '1h':
      default:    sinceMs = now - 3600000; break;
    }

    const directProbes = getNetProbes('direct', sinceMs);
    const proxyProbes = getNetProbes('proxy', sinceMs);

    const direct: NetDestResponse[] = NET_TARGETS.map(target => {
      const result = buildBuckets(directProbes, target.id, sinceMs, now);
      return { id: target.id, name: target.name, host: target.host, group: target.group, ...result };
    });

    const proxy: NetDestResponse[] = NET_TARGETS.map(target => {
      const result = buildBuckets(proxyProbes, target.id, sinceMs, now);
      return { id: target.id, name: target.name, host: target.host, group: target.group, ...result };
    });

    // 从预聚合表读取分组折线数据（国内/国际），避免实时聚合开销
    const bucketSize = (now - sinceMs) / NET_BUCKETS;
    const domesticStats     = getGroupStats('domestic',      sinceMs);
    const internationalStats = getGroupStats('international', sinceMs);

    const toLine = (stats: typeof domesticStats) =>
      Array.from({ length: NET_BUCKETS }, (_, i) => {
        const bs = sinceMs + i * bucketSize;
        const be = bs + bucketSize;
        const vals = stats
          .filter(s => s.computed_at >= bs && s.computed_at < be && s.avg_latency_ms != null)
          .map(s => s.avg_latency_ms!);
        return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
      });

    const lineDomestic      = toLine(domesticStats);
    const lineInternational = toLine(internationalStats);

    // Most recent probe timestamp
    const allProbes = [...directProbes, ...proxyProbes];
    const probedAt = latestProbedAt(allProbes, now);

    return {
      direct,
      proxy,
      lineDomestic,
      lineInternational,
      probedAt,
    };
  });

  // POST /api/network/probe — 触发一次完整探测并写入 DB（后台定时 / 手动刷新用）
  fastify.post('/api/network/probe', async () => {
    probeAll().catch(() => {
      fastify.log.error({ code: 'NETWORK_PROBE_FAILED' }, 'Background network probe failed');
    });
    return { ok: true };
  });

  // GET /api/network/ping — 实时探测，结果直接返回，不写 DB
  fastify.get('/api/network/ping', async () => {
    const proxyUrl = getActiveProxyUrl();
    const results = await Promise.allSettled(
      NET_TARGETS.flatMap(target => [
        probeTarget(target.url, '').then(r => createLivePingEntry(target.id, 'direct', target.group, r, Date.now())),
        probeTarget(target.url, proxyUrl).then(r => createLivePingEntry(target.id, 'proxy', target.group, r, Date.now())),
      ])
    );
    const out: Record<string, Record<string, { up: boolean; latencyMs: number; probedAt: number }>> = { direct: {}, proxy: {} };
    for (const r of results) {
      if (r.status === 'fulfilled') {
        const { id, path, up, latencyMs, probedAt } = r.value;
        out[path][id] = { up, latencyMs, probedAt };
      }
    }
    return out;
  });

  // GET /api/network/proxy — 当前代理地址 + 近期可用状态
  fastify.get('/api/network/proxy', async () => {
    const proxyUrl = getActiveProxyUrl();
    const since10m = Date.now() - 10 * 60 * 1000;

    const directProbes = getNetProbes('direct', since10m);
    const proxyProbes  = getNetProbes('proxy',  since10m);

    const recentAvgLat = (probes: NetProbe[]) => {
      const up = probes.filter(p => p.up === 1 && p.latency_ms != null);
      return up.length ? Math.round(up.reduce((s, p) => s + (p.latency_ms ?? 0), 0) / up.length) : 0;
    };

    const directUp  = directProbes.some(p => p.up === 1);
    const proxyUp   = proxyProbes.some(p => p.up === 1);
    const lastProbe = [...directProbes, ...proxyProbes].reduce((m, p) => Math.max(m, p.probed_at), 0);

    return {
      proxyUrl,
      hasProxy: !!proxyUrl,
      direct: { up: directUp, avgLatencyMs: recentAvgLat(directProbes) },
      proxy:  { up: proxyUp,  avgLatencyMs: recentAvgLat(proxyProbes) },
      lastProbedAt: lastProbe || null,
    };
  });

  // POST /api/network/proxy — 保存代理地址
  fastify.post<{ Body: { proxyUrl: string } }>('/api/network/proxy', async (request, reply) => {
    const { proxyUrl } = request.body;
    if (typeof proxyUrl !== 'string') {
      return reply.code(400).send({ error: 'proxyUrl must be a string' });
    }
    const trimmed = proxyUrl.trim();
    setSetting('proxyUrl', trimmed);
    return { ok: true, proxyUrl: trimmed };
  });

  // GET /api/network/clash — 读取 Clash Verge 运行配置
  fastify.get('/api/network/clash', async () => {
    try {
      const configPath = path.join(
        homedir(), 'Library', 'Application Support',
        'io.github.clash-verge-rev.clash-verge-rev', 'config.yaml'
      );
      const content = readFileSync(configPath, 'utf-8');
      return parseClashVergeConfig(content);
    } catch {
      fastify.log.warn(
        { code: 'CLASH_CONFIG_UNAVAILABLE' },
        'Clash Verge config unavailable',
      );
      return unavailableClashStatus;
    }
  });
}
