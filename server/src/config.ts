export type JsonExpectation =
  | null
  | boolean
  | number
  | string
  | { [key: string]: JsonExpectation };

export interface ServiceHealthConfig {
  timeoutMs?: number;
  expect?: {
    httpStatus?: number;
    json?: { [key: string]: JsonExpectation };
  };
}

export interface ServiceConfig {
  id: string;
  name: string;
  group: 'infra' | 'app';
  tech: string;
  checkUrl: string;
  port: string;
  addr: string;
  url?: string;
  systemd?: string;      // Linux: systemd unit name
  brewService?: string;  // macOS: `brew services` name (e.g. "nginx")
  launchAgent?: string;  // macOS: launchd label (e.g. "com.cx.cloudflared.damkeeper")
  health?: ServiceHealthConfig;
  startScript?: string;  // fallback: shell command to start
  stopScript?: string;   // fallback: shell command to stop
  logFile?: string;      // single log file path (used when logs[] not set)
  logs?: Array<{
    label: string;
    file: string;
    glyph?: string; // button icon, default '▤'
    tone?: string;  // 'mute' | 'warn' | 'danger' | 'blue' | 'go', default 'mute'
  }>;
  monitor?: { kind: 'istoreos' };
  readOnly?: boolean;
}

export interface NetTarget {
  id: string;
  name: string;
  host: string;
  url: string;
  group: 'domestic' | 'international';
}

export type NetLatencyPath = 'direct' | 'proxy';

export type NetLatencySeries = {
  id: string;
  label: string;
  source:
    | { kind: 'group'; group: NetTarget['group']; path: NetLatencyPath }
    | { kind: 'target'; targetId: string; path: NetLatencyPath };
  color: string;
  order: number;
};

export type NetLatencySeriesWarning = {
  id: string | null;
  reason: 'invalid-entry' | 'invalid-id' | 'duplicate-id' | 'invalid-group' | 'unknown-target' | 'invalid-path' | 'invalid-color';
};

export const SERVICES: ServiceConfig[] = [
  {
    id: 'istoreos-router',
    name: 'iStoreOS 软路由',
    group: 'infra',
    tech: 'iStoreOS 21.02.3 · PassWall2 / Xray',
    checkUrl: 'http://192.168.31.10/',
    port: 'SSH :22 · SOCKS :1070',
    addr: '192.168.31.10',
    url: 'http://192.168.31.10/',
    monitor: { kind: 'istoreos' },
    readOnly: true,
  },
  {
    id: 'nginx',
    name: 'Nginx',
    group: 'infra',
    tech: '反向代理 · Web 服务',
    checkUrl: 'http://localhost:8080',
    port: '80 / 443',
    addr: 'reverse-proxy',
    // url 不填 → 不显示"打开"按钮
    systemd: 'nginx',
    brewService: 'nginx',
    logs: [
      { label: '访问日志', file: '/opt/homebrew/var/log/nginx/access.log', glyph: '≡',  tone: 'mute'   },
      { label: '错误日志', file: '/opt/homebrew/var/log/nginx/error.log',  glyph: '⚠',  tone: 'danger' },
    ],
  },
  {
    id: 'cftunnel',
    name: 'Cloudflare Tunnel',
    group: 'infra',
    tech: 'cloudflared · 内网穿透',
    checkUrl: 'http://localhost:20241/metrics',
    port: '—',
    addr: 'tunnel',
    systemd: 'cloudflared',
    launchAgent: 'com.cx.cloudflared.damkeeper',  // launchctl label
  },
  {
    id: 'phenology-primary-tunnel',
    name: 'Phenology Primary Tunnel',
    group: 'infra',
    tech: '双向 SSH 隧道 · 主备互联',
    checkUrl: 'http://127.0.0.1:15177/api/system/runtime-status',
    port: ':15177 / :15178',
    addr: '127.0.0.1:15177',
    launchAgent: 'top.damkeeper.phenology-primary-tunnel',
    health: {
      timeoutMs: 5_000,
      expect: {
        httpStatus: 200,
        json: {
          runtimeRole: 'primary',
          readOnly: false,
          codex: { provider: 'rpc', status: 'available' },
        },
      },
    },
    logs: [
      { label: '标准输出', file: '/Users/cx/cx/phenology-backup/.prod/logs/tunnel.out.log', glyph: '≡', tone: 'mute' },
      { label: '标准错误', file: '/Users/cx/cx/phenology-backup/.prod/logs/tunnel.err.log', glyph: '⚠', tone: 'danger' },
    ],
  },
  {
    id: 'phenology',
    name: 'Phenology',
    group: 'app',
    tech: '时间管理',
    checkUrl: 'http://127.0.0.1:5177/',
    port: ':5177',
    addr: '127.0.0.1:5177',
    url: 'http://127.0.0.1:5177',
    launchAgent: 'top.damkeeper.phenology-prod',
    logs: [
      { label: '标准输出', file: '/Users/cx/cx/phenologyV2/.prod/logs/launchd.out.log', glyph: '≡',  tone: 'mute'   },
      { label: '标准错误', file: '/Users/cx/cx/phenologyV2/.prod/logs/launchd.err.log', glyph: '⚠',  tone: 'danger' },
    ],
  },
  {
    id: 'phenology-backup',
    name: 'Phenology Backup / Codex Worker',
    group: 'app',
    tech: '备份节点 · 本地 Codex Worker',
    checkUrl: 'http://127.0.0.1:5178/api/system/runtime-status',
    port: ':5178',
    addr: '127.0.0.1:5178',
    url: 'http://127.0.0.1:5178',
    launchAgent: 'top.damkeeper.phenology-backup',
    health: {
      timeoutMs: 5_000,
      expect: {
        httpStatus: 200,
        json: {
          runtimeRole: 'backup',
          readOnly: true,
          codex: { provider: 'local', status: 'available' },
        },
      },
    },
    logs: [
      { label: '标准输出', file: '/Users/cx/cx/phenology-backup/.prod/logs/launchd.out.log', glyph: '≡', tone: 'mute' },
      { label: '标准错误', file: '/Users/cx/cx/phenology-backup/.prod/logs/launchd.err.log', glyph: '⚠', tone: 'danger' },
    ],
  },
  {
    id: 'fin',
    name: 'Fin',
    group: 'app',
    tech: '消费管理',
    checkUrl: 'http://{LAN_IP}:5200/api/health',
    port: ':5200',
    addr: '{LAN_IP}:5200',
    url: 'http://{LAN_IP}:5200',
    launchAgent: 'com.cx.fin',
    logs: [
      { label: '标准输出', file: '/Users/cx/cx/fin/.prod/logs/out.log', glyph: '≡', tone: 'mute'   },
      { label: '标准错误', file: '/Users/cx/cx/fin/.prod/logs/err.log', glyph: '⚠', tone: 'danger' },
    ],
  },
  {
    id: 'wealthos',
    name: 'Wealth OS',
    group: 'app',
    tech: '财务管理',
    checkUrl: 'http://localhost:9137',
    port: ':9137',
    addr: '{LAN_IP}:9137',
    url: 'http://{LAN_IP}:5173',
    launchAgent: 'com.cx.wealthos',
    logs: [
      { label: '标准输出', file: '/Users/cx/cx/fin_v3/.prod/logs/out.log', glyph: '≡', tone: 'mute'   },
      { label: '标准错误', file: '/Users/cx/cx/fin_v3/.prod/logs/err.log', glyph: '⚠', tone: 'danger' },
    ],
  },
];

export const NET_TARGETS: NetTarget[] = [
  // 国内
  { id: 'baidu',    name: 'Baidu',    host: 'baidu.com',         url: 'https://www.baidu.com',         group: 'domestic' },
  { id: 'bilibili', name: 'Bilibili', host: 'bilibili.com',      url: 'https://www.bilibili.com',      group: 'domestic' },
  { id: 'xhs',      name: '小红书',   host: 'xiaohongshu.com',   url: 'https://www.xiaohongshu.com',   group: 'domestic' },
  { id: 'douban',   name: '豆瓣',     host: 'douban.com',        url: 'https://www.douban.com',        group: 'domestic' },
  // 国际
  { id: 'google',   name: 'Google',         host: 'google.com',  url: 'https://www.google.com',   group: 'international' },
  { id: 'chatgpt',  name: 'ChatGPT',        host: 'chatgpt.com', url: 'https://chatgpt.com',      group: 'international' },
  { id: 'youtube',  name: 'YouTube',        host: 'youtube.com', url: 'https://www.youtube.com',  group: 'international' },
  { id: 'github',   name: 'GitHub',         host: 'github.com',  url: 'https://github.com',       group: 'international' },
  { id: 'cfdns',    name: 'Cloudflare DNS', host: '1.1.1.1',     url: 'https://1.1.1.1',          group: 'international' },
];

export const NET_LATENCY_SERIES: NetLatencySeries[] = [
  { id: 'domestic', label: '国内', source: { kind: 'group', group: 'domestic', path: 'direct' }, color: '#22c55e', order: 10 },
  { id: 'international', label: '国际', source: { kind: 'group', group: 'international', path: 'proxy' }, color: '#a855f7', order: 20 },
  { id: 'chatgpt', label: 'ChatGPT', source: { kind: 'target', targetId: 'chatgpt', path: 'proxy' }, color: '#3b82f6', order: 30 },
  { id: 'google', label: 'Google', source: { kind: 'target', targetId: 'google', path: 'proxy' }, color: '#f59e0b', order: 40 },
];

function isPath(value: unknown): value is NetLatencyPath {
  return value === 'direct' || value === 'proxy';
}

function isUsableColor(value: unknown): value is string {
  return typeof value === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value);
}

function isSafeSeriesId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(value);
}

export function validateNetLatencySeries(entries: readonly unknown[]): { series: NetLatencySeries[]; warnings: NetLatencySeriesWarning[] } {
  const ids = new Set<string>();
  const targetIds = new Set(NET_TARGETS.map(target => target.id));
  const series: NetLatencySeries[] = [];
  const warnings: NetLatencySeriesWarning[] = [];

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') {
      warnings.push({ id: null, reason: 'invalid-entry' });
      continue;
    }
    const candidate = entry as Record<string, unknown>;
    const id = typeof candidate.id === 'string' ? candidate.id : null;
    if (id !== null && !isSafeSeriesId(id)) {
      warnings.push({ id: null, reason: 'invalid-id' });
      continue;
    }
    if (!id || typeof candidate.label !== 'string' || !candidate.label.trim() || typeof candidate.order !== 'number' || !Number.isFinite(candidate.order) || !candidate.source || typeof candidate.source !== 'object') {
      warnings.push({ id, reason: 'invalid-entry' });
      continue;
    }
    if (ids.has(id)) {
      warnings.push({ id, reason: 'duplicate-id' });
      continue;
    }
    const source = candidate.source as Record<string, unknown>;
    if (!isPath(source.path)) {
      warnings.push({ id, reason: 'invalid-path' });
      continue;
    }
    if (!isUsableColor(candidate.color)) {
      warnings.push({ id, reason: 'invalid-color' });
      continue;
    }
    if (source.kind === 'group') {
      if (source.group !== 'domestic' && source.group !== 'international') {
        warnings.push({ id, reason: 'invalid-group' });
        continue;
      }
      ids.add(id);
      series.push({ id, label: candidate.label, source: { kind: 'group', group: source.group, path: source.path }, color: candidate.color, order: candidate.order });
      continue;
    }
    if (source.kind === 'target') {
      if (typeof source.targetId !== 'string' || !targetIds.has(source.targetId)) {
        warnings.push({ id, reason: 'unknown-target' });
        continue;
      }
      ids.add(id);
      series.push({ id, label: candidate.label, source: { kind: 'target', targetId: source.targetId, path: source.path }, color: candidate.color, order: candidate.order });
      continue;
    }
    warnings.push({ id, reason: 'invalid-entry' });
  }

  return { series: series.sort((left, right) => left.order - right.order), warnings };
}

export const VPS_LINE_NODE_NAME = (process.env.VPS_LINE_NODE_NAME ?? '').trim();

// Set PROXY_URL env var to your VPN/proxy, e.g. "http://127.0.0.1:7890"
export const PROXY_URL = process.env.PROXY_URL ?? '';
