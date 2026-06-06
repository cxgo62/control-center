import type { FastifyInstance } from 'fastify';
import { SERVICES } from '../config.js';
import { getServiceChecks, getEvents, insertEvent } from '../db.js';
import { checkService, manageService, getServiceLogs, type ServiceStatus } from '../checker.js';
import { resolveIp } from '../utils.js';

// In-memory store of latest statuses
const latestStatus = new Map<string, ServiceStatus>();

export function updateServiceStatus(statuses: ServiceStatus[]): void {
  for (const s of statuses) {
    latestStatus.set(s.id, s);
  }
}

const HIST_BUCKETS = 40;
const HIST_WINDOW_MS = 24 * 60 * 60 * 1000;   // 24 小时
const BUCKET_MS = HIST_WINDOW_MS / HIST_BUCKETS; // 每桶 36 分钟

const SPARK_POINTS = 28;
const SPARK_WINDOW_MS = 2 * 60 * 60 * 1000;    // sparkline 显示最近 2 小时
const SPARK_BUCKET_MS = SPARK_WINDOW_MS / SPARK_POINTS; // 每点约 4.3 分钟

function buildServiceResponse(svc: (typeof SERVICES)[0]) {
  const now = Date.now();
  const cached = latestStatus.get(svc.id);

  // ---- 24h 状态条：40 个时间桶，每桶 36 分钟 ----
  const histSince = now - HIST_WINDOW_MS;
  const histChecks = getServiceChecks(svc.id, histSince);

  const statusHist: string[] = [];
  for (let i = 0; i < HIST_BUCKETS; i++) {
    const bucketStart = histSince + i * BUCKET_MS;
    const bucketEnd   = bucketStart + BUCKET_MS;
    const bucket = histChecks.filter(c => c.checked_at >= bucketStart && c.checked_at < bucketEnd);

    if (bucket.length === 0) {
      // 该时段无数据（服务刚注册，或数据库刚初始化）
      statusHist.push('stopped');
    } else {
      const upCount      = bucket.filter(c => c.status === 'running').length;
      const errorCount   = bucket.filter(c => c.status === 'error').length;
      const stoppedCount = bucket.filter(c => c.status === 'stopped').length;
      if (upCount > 0 && upCount >= errorCount) {
        statusHist.push('up');
      } else if (errorCount > stoppedCount) {
        statusHist.push('down');
      } else {
        statusHist.push('stopped');
      }
    }
  }

  // ---- 延迟 sparkline：28 个时间桶，覆盖最近 2 小时 ----
  const sparkSince = now - SPARK_WINDOW_MS;
  const sparkChecks = getServiceChecks(svc.id, sparkSince);

  const hist: number[] = [];
  for (let i = 0; i < SPARK_POINTS; i++) {
    const bucketStart = sparkSince + i * SPARK_BUCKET_MS;
    const bucketEnd   = bucketStart + SPARK_BUCKET_MS;
    const bucket = sparkChecks.filter(c => c.checked_at >= bucketStart && c.checked_at < bucketEnd && c.status === 'running' && (c.latency_ms ?? 0) > 0);
    if (bucket.length === 0) {
      hist.push(0);
    } else {
      hist.push(Math.round(bucket.reduce((sum, c) => sum + (c.latency_ms ?? 0), 0) / bucket.length));
    }
  }

  return {
    id: svc.id,
    name: svc.name,
    group: svc.group,
    tech: svc.tech,
    port: svc.port,
    addr: resolveIp(svc.addr),
    url: resolveIp(svc.url),
    logs: svc.logs,
    status: cached?.status ?? 'stopped',
    latencyMs: cached?.latencyMs ?? 0,
    checkedAt: cached?.checkedAt ?? now,
    startedAt: cached?.startedAt,
    lastCheck: cached?.checkedAt ?? now,
    hist,
    statusHist,
  };
}

export default async function servicesRoutes(fastify: FastifyInstance) {
  // GET /api/services
  fastify.get('/api/services', async () => {
    return SERVICES.map(svc => buildServiceResponse(svc));
  });

  // GET /api/events
  fastify.get('/api/events', async () => {
    const rows = getEvents(10);
    return rows.map(e => ({
      id: e.id,
      serviceId: e.service_id,
      color: e.color,
      message: e.message,
      createdAt: e.created_at,
    }));
  });

  // POST /api/services/:id/action
  fastify.post<{ Params: { id: string }; Body: { action: string } }>(
    '/api/services/:id/action',
    async (request, reply) => {
      const { id } = request.params;
      const { action } = request.body;

      const svc = SERVICES.find(s => s.id === id);
      if (!svc) {
        return reply.code(404).send({ error: 'Service not found' });
      }

      if (action === 'probe') {
        try {
          const status = await checkService(svc);
          latestStatus.set(id, status);
          insertEvent(id, '#5aa0fa', `${svc.name} 健康探测完成`);
          return buildServiceResponse(svc);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return reply.code(500).send({ error: msg });
        }
      }

      if (action === 'start' || action === 'stop' || action === 'restart') {
        try {
          const colorMap: Record<string, string> = {
            start: '#3fb950',
            stop: '#7d8794',
            restart: '#5aa0fa',
          };
          const verbMap: Record<string, string> = {
            start: `${svc.name} 已启动`,
            stop: `${svc.name} 已停止`,
            restart: `${svc.name} 正在重启…`,
          };

          insertEvent(id, colorMap[action], verbMap[action]);
          await manageService(svc, action);

          // After successful action, re-check
          if (action !== 'stop') {
            setTimeout(async () => {
              try {
                const status = await checkService(svc);
                latestStatus.set(id, status);
                if (status.status === 'running') {
                  insertEvent(id, '#3fb950', `${svc.name} 重启完成`);
                }
              } catch {
                // ignore
              }
            }, 2000);
          }

          return { ok: true };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return reply.code(500).send({ error: msg });
        }
      }

      return reply.code(400).send({ error: 'Unknown action' });
    }
  );

  // GET /api/services/:id/logs?lines=40&file=/path/to/log
  fastify.get<{ Params: { id: string }; Querystring: { lines?: string; file?: string } }>(
    '/api/services/:id/logs',
    async (request, reply) => {
      const { id } = request.params;
      const lines = parseInt(request.query.lines ?? '30', 10);
      const file = request.query.file; // optional specific log file path

      const svc = SERVICES.find(s => s.id === id);
      if (!svc) {
        return reply.code(404).send({ error: 'Service not found' });
      }

      const logLines = await getServiceLogs(svc, lines, file);
      return logLines;
    }
  );
}
