import { fetch, ProxyAgent, Agent } from 'undici';
import { NET_TARGETS, PROXY_URL as ENV_PROXY_URL } from './config.js';
import { insertNetProbe, insertGroupStat, getSetting } from './db.js';

/** 获取当前生效的代理地址（db 优先，其次 env，最后空） */
export function getActiveProxyUrl(): string {
  return getSetting('proxyUrl') ?? ENV_PROXY_URL ?? '';
}

// 纯探测，不写 DB —— 供实时 ping 接口使用
export async function probeTarget(url: string, proxyUrl: string): Promise<{ up: boolean; latencyMs: number }> {
  const start = Date.now();
  try {
    const dispatcher = proxyUrl
      ? new ProxyAgent(proxyUrl)
      : new Agent({ connect: { timeout: 8000 } });
    await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(8000),
      dispatcher,
    });
    return { up: true, latencyMs: Date.now() - start };
  } catch {
    return { up: false, latencyMs: Date.now() - start };
  }
}

let _probing = false;

export async function probeAll(): Promise<void> {
  if (_probing) return; // 防止前台高频触发时与后台定时探测重叠
  _probing = true;
  try {
    await _probeAll();
  } finally {
    _probing = false;
  }
}

async function _probeAll(): Promise<void> {
  const proxyUrl = getActiveProxyUrl();

  // 并行探测所有目标的两条路径
  type ProbeResult = { id: string; group: string; path: string; up: boolean; latencyMs: number };
  const results: ProbeResult[] = [];

  await Promise.allSettled(
    NET_TARGETS.flatMap(target => [
      probeTarget(target.url, '').then(r => {
        insertNetProbe(target.id, 'direct', r.up, r.up ? r.latencyMs : null);
        results.push({ id: target.id, group: target.group, path: 'direct', up: r.up, latencyMs: r.latencyMs });
      }),
      probeTarget(target.url, proxyUrl).then(r => {
        insertNetProbe(target.id, 'proxy', r.up, r.up ? r.latencyMs : null);
        results.push({ id: target.id, group: target.group, path: 'proxy', up: r.up, latencyMs: r.latencyMs });
      }),
    ])
  );

  // 按 group 聚合均值并写入 net_group_stats
  // 国内取 direct 路径，国际取 proxy 路径（与卡片展示逻辑一致）
  for (const [group, path] of [['domestic', 'direct'], ['international', 'proxy']] as const) {
    const up = results.filter(r => r.group === group && r.path === path && r.up);
    const avg = up.length
      ? Math.round(up.reduce((s, r) => s + r.latencyMs, 0) / up.length)
      : null;
    insertGroupStat(group, avg);
  }
}
