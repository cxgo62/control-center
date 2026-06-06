import React from 'react';
import type { ServiceInfo, LogLine } from '../types.js';

// ---- Status definitions ----
export const CC_STATUS: Record<string, { key: string; label: string; color: string; dim: string; ring: string }> = {
  running:    { key: 'running',    label: '运行中', color: '#3fb950', dim: 'rgba(63,185,80,.13)',   ring: 'rgba(63,185,80,.35)'  },
  paused:     { key: 'paused',     label: '已暂停', color: '#d9a531', dim: 'rgba(217,165,49,.13)',  ring: 'rgba(217,165,49,.35)' },
  stopped:    { key: 'stopped',    label: '已停止', color: '#7d8794', dim: 'rgba(125,135,148,.13)', ring: 'rgba(125,135,148,.32)'},
  error:      { key: 'error',      label: '异常',   color: '#f15a4a', dim: 'rgba(241,90,74,.13)',   ring: 'rgba(241,90,74,.35)'  },
  restarting: { key: 'restarting', label: '重启中', color: '#4493f8', dim: 'rgba(68,147,248,.13)',  ring: 'rgba(68,147,248,.4)'  },
  starting:   { key: 'starting',   label: '启动中', color: '#4493f8', dim: 'rgba(68,147,248,.13)',  ring: 'rgba(68,147,248,.4)'  },
  stopping:   { key: 'stopping',   label: '停止中', color: '#d9a531', dim: 'rgba(217,165,49,.13)',  ring: 'rgba(217,165,49,.35)' },
};

// 所有不稳定的过渡态
const TRANSITIONAL = new Set(['restarting', 'starting', 'stopping']);

export const CC_TONE: Record<string, { c: string; bg: string; bd: string }> = {
  go:     { c: '#3fb950', bg: 'rgba(63,185,80,.10)',   bd: 'rgba(63,185,80,.30)'   },
  warn:   { c: '#d9a531', bg: 'rgba(217,165,49,.10)',  bd: 'rgba(217,165,49,.30)'  },
  blue:   { c: '#5aa0fa', bg: 'rgba(68,147,248,.10)',  bd: 'rgba(68,147,248,.30)'  },
  mute:   { c: '#aab4c2', bg: 'rgba(255,255,255,.035)',bd: 'rgba(255,255,255,.10)' },
  danger: { c: '#f15a4a', bg: 'rgba(241,90,74,.10)',   bd: 'rgba(241,90,74,.30)'   },
};

export const CC_ACT: Record<string, { label: string; glyph: string; tone: string }> = {
  start:   { label: '启动', glyph: '▶',  tone: 'go'   },
  pause:   { label: '暂停', glyph: '❚❚', tone: 'warn' },
  stop:    { label: '停止', glyph: '■',  tone: 'mute' },
  restart: { label: '重启', glyph: '↻',  tone: 'blue' },
  logs:    { label: '日志', glyph: '▤',  tone: 'mute' },
  open:    { label: '打开', glyph: '↗',  tone: 'mute' },
  probe:   { label: '探测', glyph: '◎',  tone: 'mute' },
};

function ccActionsFor(svc: ServiceInfo): string[] {
  const hasUrl = !!svc.url;
  switch (svc.status) {
    case 'running':    return ['restart', 'logs', ...(hasUrl ? ['open'] : []), 'probe', 'stop'];
    case 'stopped':    return ['start', 'restart', 'logs', 'probe'];
    case 'error':      return ['restart', 'start', 'logs', 'probe', 'stop'];
    case 'restarting':
    case 'starting':
    case 'stopping':   return ['logs'];
    default:           return ['logs'];
  }
}

// ---- Helpers ----
export function fmtUptime(sec: number): string {
  if (sec <= 0) return '—';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (d > 0) return `${d}天 ${h}时 ${String(m).padStart(2, '0')}分`;
  if (h > 0) return `${h}时 ${String(m).padStart(2, '0')}分 ${String(s).padStart(2, '0')}秒`;
  return `${m}分 ${String(s).padStart(2, '0')}秒`;
}

export function fmtAgo(ts: number): string {
  if (!ts) return '从未';
  const d = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (d < 3) return '刚刚';
  if (d < 60) return `${d} 秒前`;
  if (d < 3600) return `${Math.floor(d / 60)} 分钟前`;
  return `${Math.floor(d / 3600)} 小时前`;
}

// ---- Components ----

interface StatusDotProps {
  status: string;
  size?: number;
  pulse?: boolean;
}

export function StatusDot({ status, size = 8, pulse = true }: StatusDotProps) {
  const m = CC_STATUS[status] ?? CC_STATUS.stopped;
  const animate = pulse && (status === 'running' || status === 'error' || status === 'restarting');
  return (
    <span style={{ position: 'relative', display: 'inline-flex', width: size, height: size, flex: 'none' }}>
      {animate && (
        <span style={{
          position: 'absolute', inset: 0, borderRadius: '50%',
          background: m.color, animation: 'ccPulse 1.8s ease-out infinite',
        }} />
      )}
      <span style={{
        position: 'relative', width: size, height: size, borderRadius: '50%',
        background: m.color, boxShadow: `0 0 0 ${Math.round(size / 2)}px ${m.dim}`,
      }} />
    </span>
  );
}

interface StatusPillProps {
  status: string;
  mono?: boolean;
}

export function StatusPill({ status, mono = true }: StatusPillProps) {
  const m = CC_STATUS[status] ?? CC_STATUS.stopped;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 7,
      padding: '3px 9px 3px 8px', borderRadius: 999,
      background: m.dim, border: `1px solid ${m.ring}`,
      color: m.color, fontSize: 11.5, fontWeight: 600, letterSpacing: '.02em',
      fontFamily: mono ? '"JetBrains Mono", monospace' : 'inherit',
      whiteSpace: 'nowrap',
    }}>
      <StatusDot status={status} size={7} />{m.label}
    </span>
  );
}

interface ActionBtnProps {
  act: string;
  primary?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  compact?: boolean;
}

export function ActionBtn({ act, primary, disabled, onClick, compact }: ActionBtnProps) {
  const meta = CC_ACT[act] ?? CC_ACT.logs;
  let tone = meta.tone;
  if (act === 'stop') tone = 'danger';
  const t = CC_TONE[tone] ?? CC_TONE.mute;
  const [hover, setHover] = React.useState(false);
  const showLabel = primary || !compact;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={meta.label}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: showLabel ? 6 : 0,
        padding: showLabel ? '5px 11px' : '5px 7px', borderRadius: 7,
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontFamily: 'system-ui,-apple-system,sans-serif',
        fontSize: 12, fontWeight: 600, lineHeight: 1,
        color: disabled ? '#5b636f' : (primary ? '#0b0e14' : t.c),
        background: disabled ? 'transparent' : (primary ? t.c : (hover ? t.bg : 'rgba(255,255,255,.02)')),
        border: `1px solid ${disabled ? 'rgba(255,255,255,.06)' : (primary ? t.c : (hover ? t.bd : 'rgba(255,255,255,.08)'))}`,
        opacity: disabled ? 0.5 : 1, transition: 'all .14s ease', whiteSpace: 'nowrap',
      }}
    >
      <span style={{
        fontSize: act === 'pause' ? 9 : 12, display: 'inline-block',
        transform: act === 'restart' ? 'translateY(-.5px)' : 'none',
      }}>{meta.glyph}</span>
      {showLabel && <span>{meta.label}</span>}
    </button>
  );
}

export interface LogEntry {
  label: string;
  file: string;
  glyph?: string;
  tone?: string;
}

interface ServiceActionsProps {
  svc: ServiceInfo;
  onAction: (id: string, action: string) => void;
  onLogs: (svc: ServiceInfo, entry?: LogEntry) => void;
  onToast?: (msg: string) => void;
  compact?: boolean;
  max?: number;
}

export function ServiceActions({ svc, onAction, onLogs, onToast, compact = false, max = 99 }: ServiceActionsProps) {
  const keys = ccActionsFor(svc).slice(0, max);

  const run = (k: string) => {
    if (k === 'logs') { onLogs(svc); return; }
    if (k === 'open') {
      if (svc.url) window.open(svc.url, '_blank');
      return;
    }
    if (k === 'probe') {
      onAction(svc.id, 'probe');
      onToast?.(`已向 ${svc.name} 发起健康探测`);
      return;
    }
    onAction(svc.id, k);
  };

  // 过渡态：显示 spinner + 文字，禁用所有操作
  if (TRANSITIONAL.has(svc.status)) {
    const m = CC_STATUS[svc.status];
    const spinBorder = svc.status === 'stopping'
      ? 'rgba(217,165,49,.25)' : 'rgba(68,147,248,.25)';
    const spinTop = svc.status === 'stopping' ? '#d9a531' : '#5aa0fa';
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: m.color, fontSize: 12.5, fontWeight: 600 }}>
        <span className="cc-spin" style={{
          width: 13, height: 13, borderRadius: '50%',
          border: `2px solid ${spinBorder}`, borderTopColor: spinTop, display: 'inline-block',
        }} />
        {m.label}…
      </div>
    );
  }

  // 把 'logs' 这个 key 替换成每个具名日志的按钮（如果 svc.logs 存在）
  const renderedKeys = keys.flatMap(k => (k === 'logs' && svc.logs?.length) ? ['__logs__'] : [k]);

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {renderedKeys.map((k, i) => {
        if (k === '__logs__') {
          // 渲染多个具名日志按钮，样式与 'logs' 保持一致
          return svc.logs!.map(entry => (
            <LogFileBtn
              key={entry.file}
              entry={entry}
              primary={i === 0 && svc.logs!.indexOf(entry) === 0}
              compact={compact}
              onClick={() => onLogs(svc, entry)}
            />
          ));
        }
        return (
          <ActionBtn
            key={k} act={k} primary={i === 0} compact={compact}
            onClick={() => run(k)}
          />
        );
      })}
    </div>
  );
}

// 具名日志按钮（与 ActionBtn 风格一致）
interface LogFileBtnProps {
  entry: LogEntry;
  primary?: boolean;
  compact?: boolean;
  onClick: () => void;
}
function LogFileBtn({ entry, primary, compact, onClick }: LogFileBtnProps) {
  const t = CC_TONE[entry.tone ?? 'mute'] ?? CC_TONE.mute;
  const glyph = entry.glyph ?? '▤';
  const [hover, setHover] = React.useState(false);
  const showLabel = primary || !compact;
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={entry.label}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: showLabel ? 6 : 0,
        padding: showLabel ? '5px 11px' : '5px 7px', borderRadius: 7,
        cursor: 'pointer',
        fontFamily: 'system-ui,-apple-system,sans-serif',
        fontSize: 12, fontWeight: 600, lineHeight: 1,
        color: primary ? '#0b0e14' : t.c,
        background: primary ? t.c : (hover ? t.bg : 'rgba(255,255,255,.02)'),
        border: `1px solid ${primary ? t.c : (hover ? t.bd : 'rgba(255,255,255,.08)')}`,
        transition: 'all .14s ease', whiteSpace: 'nowrap',
      }}
    >
      <span style={{ fontSize: 11 }}>{glyph}</span>
      {showLabel && <span style={{ marginLeft: 5 }}>{entry.label}</span>}
    </button>
  );
}

interface MiniSparkProps {
  data: number[];
  color: string;
  w?: number;
  h?: number;
  fill?: boolean;
}

export function MiniSpark({ data, color, w = 120, h = 30, fill = true }: MiniSparkProps) {
  const id = React.useId();
  const gid = `g${id.replace(/:/g, '')}`;

  if (!data || data.every(v => v === 0)) {
    return (
      <svg width={w} height={h}>
        <line x1="0" y1={h - 4} x2={w} y2={h - 4} stroke="rgba(255,255,255,.10)" strokeWidth="1.5" strokeDasharray="3 4" />
      </svg>
    );
  }

  const max = Math.max(...data) * 1.15 || 1;
  const min = 0;
  const pts = data.map((v, i) => [
    (i / (data.length - 1)) * w,
    h - 2 - ((v - min) / (max - min)) * (h - 5),
  ]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const area = `${line} L${w} ${h} L0 ${h} Z`;

  return (
    <svg width={w} height={h} style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity=".28" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={area} fill={`url(#${gid})`} />}
      <path d={line} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="2.4" fill={color} />
    </svg>
  );
}

interface StatusBarProps {
  hist: string[];
  height?: number;
}

export function StatusBar({ hist, height = 30 }: StatusBarProps) {
  const col: Record<string, string> = {
    up: '#3fb950', down: '#f15a4a', paused: '#d9a531', stopped: '#7d8794',
  };
  const lab: Record<string, string> = {
    up: '运行中', down: '中断', paused: '已暂停', stopped: '已停止',
  };
  return (
    <div style={{ display: 'flex', gap: 2, height, alignItems: 'stretch' }}>
      {hist.map((s, i) => (
        <div
          key={i}
          title={lab[s] ?? s}
          style={{
            flex: 1, borderRadius: 2,
            background: col[s] ?? '#7d8794',
            opacity: 0.5 + 0.5 * i / hist.length,
          }}
        />
      ))}
    </div>
  );
}

interface HealthRingProps {
  pct: number;
  size?: number;
  stroke?: number;
  color?: string;
  track?: string;
  children?: React.ReactNode;
}

export function HealthRing({
  pct, size = 88, stroke = 8,
  color = '#3fb950', track = 'rgba(255,255,255,.07)',
  children,
}: HealthRingProps) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - pct);
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color}
          strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={off}
          style={{ transition: 'stroke-dashoffset .6s ease' }}
        />
      </svg>
      <div style={{
        position: 'absolute', inset: 0, display: 'flex',
        flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      }}>
        {children}
      </div>
    </div>
  );
}

// ---- Log Drawer ----

interface LogDrawerProps {
  svc: ServiceInfo | null;
  lines: LogLine[];
  logLabel?: string;   // e.g. "访问日志" / "错误日志"
  logFile?: string;    // file path shown in subtitle
  onClose: () => void;
}

export function LogDrawer({ svc, lines, logLabel, logFile, onClose }: LogDrawerProps) {
  if (!svc) return null;

  const lc: Record<string, string> = {
    info: '#8b98a9',
    warn: '#d9a531',
    error: '#f15a4a',
  };

  const subtitle = logFile ?? `journalctl -fu ${svc.id}.service`;
  const title = logLabel ?? '实时日志';

  return (
    <div
      onClick={onClose}
      style={{
        position: 'absolute', inset: 0, zIndex: 60,
        background: 'rgba(4,6,10,.55)', backdropFilter: 'blur(2px)',
        display: 'flex', justifyContent: 'flex-end',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 520, maxWidth: '92%', height: '100%',
          background: '#0c1016', borderLeft: '1px solid rgba(255,255,255,.08)',
          boxShadow: '-30px 0 60px rgba(0,0,0,.5)',
          display: 'flex', flexDirection: 'column',
          animation: 'ccSlideIn .22s ease',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '16px 18px', borderBottom: '1px solid rgba(255,255,255,.07)',
        }}>
          <StatusDot status={svc.status} size={9} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#e6edf3' }}>
              {svc.name} <span style={{ color: '#5b636f', fontWeight: 500 }}>· {title}</span>
            </div>
            <div style={{ fontSize: 11.5, color: '#5b636f', fontFamily: '"JetBrains Mono",monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {subtitle}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              width: 30, height: 30, borderRadius: 7,
              border: '1px solid rgba(255,255,255,.1)',
              background: 'transparent', color: '#8b98a9',
              cursor: 'pointer', fontSize: 16, lineHeight: 1,
            }}
          >✕</button>
        </div>
        <div style={{
          flex: 1, overflow: 'auto', padding: '12px 16px',
          fontFamily: '"JetBrains Mono",monospace', fontSize: 12.5, lineHeight: 1.85,
        }}>
          {lines.length === 0 ? (
            <div style={{ color: '#525a66', fontStyle: 'italic' }}>
              {svc.status === 'running' ? '正在加载日志…' : '无日志（服务未在 Linux 上运行）'}
            </div>
          ) : lines.map((l, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              <span style={{
                color: lc[l.level] ?? '#8b98a9', flex: 'none', width: 42,
                textTransform: 'uppercase', fontSize: 10.5, fontWeight: 700, paddingTop: 1,
              }}>{l.level}</span>
              <span style={{
                color: l.level === 'error' ? '#f3b0a8' : l.level === 'warn' ? '#e6cf9a' : '#aeb9c7',
              }}>{l.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---- Toasts ----

export interface ToastItem {
  id: string;
  msg: string;
}

export function useToast() {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const push = (msg: string) => {
    const id = Math.random().toString(36).slice(2);
    setItems(p => [...p, { id, msg }]);
    setTimeout(() => setItems(p => p.filter(x => x.id !== id)), 2600);
  };
  return { items, push };
}

interface ToastStackProps {
  items: ToastItem[];
}

export function ToastStack({ items }: ToastStackProps) {
  return (
    <div style={{
      position: 'absolute', left: '50%', bottom: 22,
      transform: 'translateX(-50%)', zIndex: 80,
      display: 'flex', flexDirection: 'column', gap: 8,
      alignItems: 'center', pointerEvents: 'none',
    }}>
      {items.map(t => (
        <div key={t.id} style={{
          background: '#1a212c', border: '1px solid rgba(255,255,255,.12)',
          borderRadius: 9, padding: '9px 16px',
          color: '#e6edf3', fontSize: 13, fontWeight: 500,
          boxShadow: '0 12px 30px rgba(0,0,0,.45)',
          animation: 'ccToast .2s ease', whiteSpace: 'nowrap',
        }}>{t.msg}</div>
      ))}
    </div>
  );
}
