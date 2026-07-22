import React from 'react';
import type { NetworkData, NetDest, NetBucket } from '../types.js';
import { api } from '../api.js';
import { StatusDot, ToastStack, useToast, fmtAgo } from './Shared.js';
import { cardHoverPosition, formatBucketTooltip } from './uptime-bar-tooltip.js';

const NET_BUCKETS = 48;

const NET_RANGES = [
  { key: '1h',  label: '1 小时',  ticks: ['-60分', '-45分', '-30分', '-15分', '现在'] },
  { key: '6h',  label: '6 小时',  ticks: ['-6时',  '-4.5时', '-3时',  '-1.5时', '现在'] },
  { key: '24h', label: '24 小时', ticks: ['-24时', '-18时',  '-12时', '-6时',   '现在'] },
  { key: '7d',  label: '7 天',    ticks: ['-7天',  '-5天',   '-3天',  '-1天',   '现在'] },
];

function availColor(a: number): string {
  return a >= 99.5 ? '#3fb950' : a >= 98 ? '#7bcf4f' : a >= 93 ? '#d9a531' : '#f15a4a';
}

function useWidth(): [React.RefObject<HTMLDivElement>, number] {
  const ref = React.useRef<HTMLDivElement>(null);
  const [w, setW] = React.useState(760);
  React.useEffect(() => {
    if (!ref.current || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(es => {
      for (const e of es) setW(e.contentRect.width);
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

// ---- Dual-line latency chart ----
interface NetLineChartProps {
  lineDirect: number[];
  lineProxy: number[];
  ticks: string[];
}

function NetLineChart({ lineDirect, lineProxy, ticks }: NetLineChartProps) {
  const [ref, w] = useWidth();
  const h = 200, padL = 40, padR = 12, padT = 14, padB = 26;
  const iw = Math.max(60, w - padL - padR);
  const ih = h - padT - padB;

  const all = [...lineDirect, ...lineProxy].filter(v => v > 0);
  const max = Math.max(40, Math.ceil((Math.max(...all, 1) * 1.2) / 20) * 20);

  const X = (i: number) => padL + (i / (NET_BUCKETS - 1)) * iw;
  const Y = (v: number) => padT + ih - (v / max) * ih;

  const pathStr = (arr: number[]) => {
    let d = '', pen = false;
    arr.forEach((v, i) => {
      if (v <= 0) { pen = false; return; }
      d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1) + ' ';
      pen = true;
    });
    return d.trim();
  };

  const areaPath = (arr: number[], gid: string) => {
    const pts = arr.map((v, i) => [X(i), v > 0 ? Y(v) : null] as [number, number | null]).filter(p => p[1] !== null) as [number, number][];
    if (pts.length < 2) return null;
    const d = 'M' + pts.map(p => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' L')
      + ` L${pts[pts.length - 1][0].toFixed(1)} ${padT + ih} L${pts[0][0].toFixed(1)} ${padT + ih} Z`;
    return <path d={d} fill={`url(#${gid})`} />;
  };

  const grid = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div ref={ref} style={{ width: '100%' }}>
      <svg width={w} height={h} style={{ display: 'block' }}>
        <defs>
          <linearGradient id="ngD" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#5aa0fa" stopOpacity=".22" />
            <stop offset="1" stopColor="#5aa0fa" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="ngP" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#9b8cfa" stopOpacity=".22" />
            <stop offset="1" stopColor="#9b8cfa" stopOpacity="0" />
          </linearGradient>
        </defs>
        {grid.map((g, i) => {
          const y = padT + ih - g * ih;
          return (
            <g key={i}>
              <line x1={padL} y1={y} x2={w - padR} y2={y} stroke="rgba(255,255,255,.055)" strokeWidth="1" />
              <text x={padL - 8} y={y + 3.5} textAnchor="end" fontSize="10" fill="#525a66" fontFamily="'JetBrains Mono',monospace">
                {Math.round(g * max)}
              </text>
            </g>
          );
        })}
        {ticks.map((t, i) => {
          const x = padL + (i / (ticks.length - 1)) * iw;
          return (
            <text key={i} x={x} y={h - 7}
              textAnchor={i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'}
              fontSize="10" fill="#525a66" fontFamily="'JetBrains Mono',monospace">{t}</text>
          );
        })}
        {areaPath(lineDirect, 'ngD')}
        {areaPath(lineProxy, 'ngP')}
        <path d={pathStr(lineProxy)} fill="none" stroke="#9b8cfa" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <path d={pathStr(lineDirect)} fill="none" stroke="#5aa0fa" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </div>
  );
}

// ---- Uptime bar ----
interface UptimeBarProps {
  buckets: NetBucket[];
  height?: number;
}

function UptimeBar({ buckets, height = 8 }: UptimeBarProps) {
  if (buckets.length === 0) {
    return <div style={{ height, borderRadius: 4, background: 'rgba(255,255,255,.07)' }} />;
  }
  // hard-stop 渐变：
  //   有数据 + 正常  → 绿色
  //   有数据 + 断线  → 红色
  //   无数据（空桶） → 灰色（不代表故障）
  const stops = buckets.flatMap((b, i) => {
    const p1 = `${(i / buckets.length * 100).toFixed(2)}%`;
    const p2 = `${((i + 1) / buckets.length * 100).toFixed(2)}%`;
    const color = !b.hasData ? 'rgba(255,255,255,.10)' : b.up ? '#3fb950' : '#f15a4a';
    return [`${color} ${p1}`, `${color} ${p2}`];
  }).join(', ');

  return (
    <div style={{
      height,
      borderRadius: 4,
      background: `linear-gradient(to right, ${stops})`,
    }} />
  );
}

// ---- Compact target row (for grid card) ----
function NetTargetRow({ t }: { t: NetDest }) {
  const [hovered, setHovered] = React.useState<{ index: number; x: number } | null>(null);
  const avgLat = React.useMemo(() => {
    const up = t.buckets.filter(b => b.hasData && b.up && b.latencyMs > 0);
    return up.length ? Math.round(up.reduce((s, b) => s + b.latencyMs, 0) / up.length) : 0;
  }, [t.buckets]);
  const tooltip = hovered ? formatBucketTooltip(t.buckets[hovered.index]) : null;

  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setHovered(cardHoverPosition(event.clientX - rect.left, rect.width, 10, t.buckets.length));
  };

  const Stat = ({ label, value, color }: { label: string; value: string; color?: string }) => (
    <div>
      <div style={{ fontSize: 8, color: '#525a66', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 1 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: color ?? '#9aa5b3', fontFamily: '"JetBrains Mono",monospace', lineHeight: 1 }}>{value}</div>
    </div>
  );

  return (
    <div style={{
      position: 'relative', zIndex: hovered ? 2 : 1,
      background: 'rgba(255,255,255,.03)',
      border: '1px solid rgba(255,255,255,.06)',
      borderRadius: 7,
      padding: '5px 9px',
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
    }} onMouseMove={handleMouseMove} onMouseLeave={() => setHovered(null)}>
      {tooltip && hovered && (
        <div style={{
          position: 'absolute', left: hovered.x, bottom: 'calc(100% + 7px)', transform: 'translateX(-50%)',
          pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 3,
          background: '#252d3b', border: '1px solid rgba(255,255,255,.15)', borderRadius: 6,
          padding: '6px 9px', color: '#e6edf3', fontSize: 11, lineHeight: 1,
          fontFamily: '"JetBrains Mono",monospace', boxShadow: '0 8px 18px rgba(0,0,0,.35)',
        }}>
          {tooltip}
          <span style={{
            position: 'absolute', top: '100%', left: '50%', marginLeft: -5,
            border: '5px solid transparent', borderTopColor: '#252d3b',
          }} />
        </div>
      )}
      {/* grid: [名称区 flex] [延迟 54px] [均值 54px] [可用率 50px] */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 54px 54px 50px',
        alignItems: 'center',
        gap: 6,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, overflow: 'hidden' }}>
          <StatusDot status={t.up ? 'running' : 'error'} size={6} />
          <span style={{ fontSize: 11, fontWeight: 600, color: '#e9eef4', whiteSpace: 'nowrap' }}>{t.name}</span>
          <span style={{ fontSize: 9.5, color: '#5b636f', fontFamily: '"JetBrains Mono",monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.host}</span>
        </div>
        <Stat label="延迟" value={t.up ? `${t.latencyMs}ms` : '—'} color={t.up ? '#cdd6e1' : '#4b5563'} />
        <Stat label="均值" value={avgLat ? `${avgLat}ms` : '—'} />
        <Stat label="可用率" value={`${t.avail.toFixed(1)}%`} color={availColor(t.avail)} />
      </div>

      {/* 色带：60% 宽 */}
      <div style={{ width: '60%' }}>
        <UptimeBar buckets={t.buckets} height={3} />
      </div>
    </div>
  );
}

// ---- Geographic region card (fits in a grid cell) ----
interface NetRegionCardProps {
  title: string;
  sub: string;
  accent: string;
  path: string;   // 'direct' | 'proxy' — label for what path this shows
  targets: NetDest[];
  ticks: string[];
}

function NetRegionCard({ title, sub, accent, path, targets, ticks }: NetRegionCardProps) {
  const avgAvail = targets.length > 0 ? targets.reduce((a, t) => a + t.avail, 0) / targets.length : 0;
  const onN = targets.filter(t => t.up).length;
  return (
    <div style={{
      background: '#10151d', border: '1px solid rgba(255,255,255,.07)',
      borderRadius: 16, padding: '16px 18px 12px',
      display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'visible',
    }}>
      {/* Card header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flex: 'none' }}>
        <span style={{ width: 3, height: 28, borderRadius: 2, background: accent, flex: 'none' }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#e9eef4' }}>{title}</span>
            <span style={{ fontSize: 10, color: '#5b636f', fontFamily: '"JetBrains Mono",monospace', letterSpacing: '.06em' }}>{sub}</span>
          </div>
          <div style={{ fontSize: 10.5, color: '#6b7482', marginTop: 2 }}>
            {path === 'direct' ? '直连路径 · DIRECT' : '代理路径 · VIA PROXY'}
          </div>
        </div>
        <div style={{ textAlign: 'right', flex: 'none' }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: availColor(avgAvail), fontFamily: '"JetBrains Mono",monospace', lineHeight: 1 }}>
            {avgAvail.toFixed(1)}<span style={{ fontSize: 10, color: '#6b7482' }}>%</span>
          </div>
          <div style={{ fontSize: 10, color: '#6b7482', marginTop: 3, fontFamily: '"JetBrains Mono",monospace' }}>
            {onN}/{targets.length} 在线
          </div>
        </div>
      </div>

      {/* Target rows */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {targets.map(t => <NetTargetRow key={t.id} t={t} />)}
      </div>

      {/* Time axis */}
      <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8, fontSize: 9.5, color: '#525a66', fontFamily: '"JetBrains Mono",monospace', flex: 'none' }}>
        <span>{ticks[0]}</span><span>{ticks[Math.floor(ticks.length / 2)]}</span><span>{ticks[ticks.length - 1]}</span>
      </div>
    </div>
  );
}

// ---- Summary card (top-right grid cell) ----
interface SummaryCardProps {
  overall: number;
  dAvg: number;
  pAvg: number;
  onN: number;
  totalN: number;
  probedAt: number;
  range: string;
  onRangeChange: (r: string) => void;
}

function SummaryCard({ overall, dAvg, pAvg, onN, totalN, probedAt, range, onRangeChange }: SummaryCardProps) {
  const Metric = ({ label, value, unit, color }: { label: string; value: string | number; unit: string; color?: string }) => (
    <div style={{ padding: '12px 14px', background: 'rgba(255,255,255,.03)', borderRadius: 10, border: '1px solid rgba(255,255,255,.06)' }}>
      <div style={{ fontSize: 9.5, letterSpacing: '.1em', textTransform: 'uppercase', color: '#6b7482', fontWeight: 700, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: color ?? '#e9eef4', fontFamily: '"JetBrains Mono",monospace', lineHeight: 1 }}>
        {value}<span style={{ fontSize: 11, color: '#6b7482', marginLeft: 2 }}>{unit}</span>
      </div>
    </div>
  );

  return (
    <div style={{
      background: '#10151d', border: '1px solid rgba(255,255,255,.07)',
      borderRadius: 16, padding: '16px 18px',
      display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 'none' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#cdd6e1' }}>概览</span>
        <span style={{ fontSize: 10, color: '#525a66', fontFamily: '"JetBrains Mono",monospace' }}>
          最后探测 {fmtAgo(probedAt)}
        </span>
        {/* Time range selector */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 2, background: '#0c1016', border: '1px solid rgba(255,255,255,.08)', borderRadius: 8, padding: 2 }}>
          {NET_RANGES.map(r => (
            <button key={r.key} onClick={() => onRangeChange(r.key)} style={{
              padding: '4px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
              fontSize: 11.5, fontWeight: 600, fontFamily: 'inherit',
              background: range === r.key ? 'rgba(90,160,250,.18)' : 'transparent',
              color: range === r.key ? '#7fb4ff' : '#6b7482', transition: 'all .14s',
            }}>{r.label}</button>
          ))}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, flex: 1 }}>
        <Metric label="整体可用率" value={overall.toFixed(1)} unit="%" color={availColor(overall)} />
        <Metric label="探测点在线" value={`${onN}/${totalN}`} unit="" color={onN === totalN ? '#3fb950' : '#d9a531'} />
        <Metric label="国内均值" value={dAvg || '—'} unit={dAvg ? 'ms' : ''} color="#3fb950" />
        <Metric label="国际均值" value={pAvg || '—'} unit={pAvg ? 'ms' : ''} color="#9b8cfa" />
      </div>
    </div>
  );
}

// ---- Proxy status types ----
interface ProxyStatus {
  proxyUrl: string;
  hasProxy: boolean;
  direct: { up: boolean; avgLatencyMs: number };
  proxy:  { up: boolean; avgLatencyMs: number };
  lastProbedAt: number | null;
}

interface FlClashConfig {
  mixedPort: number;
  mode: string;
  tunEnabled: boolean;
  tunStack: string;
  error?: string;
}

// ---- Network sidebar ----
interface LinkStats { up: boolean; avgLatencyMs: number; }

interface NetworkSidebarProps {
  onProbe: () => void;
  probing: boolean;
  domestic: LinkStats;
  international: LinkStats;
}

function NetworkSidebar({ onProbe, probing, domestic, international }: NetworkSidebarProps) {
  const [status, setStatus] = React.useState<ProxyStatus | null>(null);
  const [flclash, setFlclash] = React.useState<FlClashConfig | null>(null);
  const [showModal, setShowModal] = React.useState(false);
  const [modalUrl, setModalUrl] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);

  const fetchStatus = React.useCallback(async () => {
    try {
      const s = await api.getNetworkProxy();
      setStatus(s);
    } catch { /* ignore */ }
  }, []);

  const fetchFlClash = React.useCallback(async () => {
    try {
      const f = await api.getFlClash();
      setFlclash(f);
    } catch { /* ignore */ }
  }, []);

  React.useEffect(() => { fetchStatus(); fetchFlClash(); }, [fetchStatus, fetchFlClash]);
  React.useEffect(() => {
    const t = setInterval(fetchStatus, 30_000);
    return () => clearInterval(t);
  }, [fetchStatus]);

  const openModal = () => {
    setModalUrl(status?.proxyUrl ?? '');
    setSaved(false);
    setShowModal(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.setNetworkProxy(modalUrl.trim());
      setSaved(true);
      await fetchStatus();
      onProbe();
      setTimeout(() => { setSaved(false); setShowModal(false); }, 900);
    } catch { /* ignore */ }
    finally { setSaving(false); }
  };

  const handleClear = async () => {
    setSaving(true);
    try {
      await api.setNetworkProxy('');
      await fetchStatus();
      onProbe();
      setShowModal(false);
    } catch { /* ignore */ }
    finally { setSaving(false); }
  };

  const hasProxy = status?.hasProxy ?? false;

  const StatusRow = ({ label, up, latency, accent }: {
    label: string; up: boolean; latency: number; accent: string;
  }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <span style={{
        width: 7, height: 7, borderRadius: '50%', flex: 'none',
        background: up ? accent : '#f15a4a',
        boxShadow: `0 0 6px ${up ? `${accent}66` : '#f15a4a66'}`,
      }} />
      <span style={{ fontSize: 11.5, color: '#aab4c2', flex: 1 }}>{label}</span>
      <span style={{ fontSize: 11, fontWeight: 700, fontFamily: '"JetBrains Mono",monospace',
        color: up ? accent : '#f15a4a' }}>
        {up ? `${latency}ms` : 'down'}
      </span>
    </div>
  );

  return (
    <>
      <div style={{
        width: 300, flex: 'none',
        background: '#10151d', border: '1px solid rgba(255,255,255,.07)',
        borderRadius: 16, padding: '16px 16px',
        display: 'flex', flexDirection: 'column', gap: 14,
        overflowY: 'auto',
      }}>
        {/* Title */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 2 }}>
            <div style={{ width: 7, height: 7, borderRadius: 2, background: '#5aa0fa', boxShadow: '0 0 7px rgba(90,160,250,.6)', flex: 'none' }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: '#cdd6e1' }}>网络概览</span>
          </div>
          <div style={{ fontSize: 10, color: '#5b636f', fontFamily: '"JetBrains Mono",monospace' }}>
            {status?.lastProbedAt ? fmtAgo(status.lastProbedAt) : '加载中…'}
          </div>
        </div>

        {/* FlClash status block */}
        {flclash && !flclash.error && (
          <div style={{
            borderRadius: 10,
            border: '1px solid rgba(90,160,250,.2)',
            background: 'rgba(90,160,250,.05)',
            overflow: 'hidden',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '8px 11px 7px',
              borderBottom: '1px solid rgba(255,255,255,.06)',
            }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#7fb4ff', letterSpacing: '.04em' }}>FlClash</span>
              <span style={{ fontSize: 9.5, fontFamily: '"JetBrains Mono",monospace', color: '#525a66' }}>v0.8.92</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: 'rgba(255,255,255,.04)' }}>
              {[
                { label: 'TUN 模式', value: flclash.tunEnabled ? '已开启' : '未开启', color: flclash.tunEnabled ? '#3fb950' : '#d9a531' },
                { label: '协议栈',   value: flclash.tunStack,                          color: '#cdd6e1' },
                { label: '代理端口', value: flclash.mixedPort ? `:${flclash.mixedPort}` : '—', color: '#9b8cfa' },
                { label: '路由模式', value: flclash.mode,                              color: '#aab4c2' },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ padding: '8px 11px', background: '#10151d' }}>
                  <div style={{ fontSize: 9, color: '#525a66', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 3 }}>{label}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color, fontFamily: '"JetBrains Mono",monospace' }}>{value}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Network status */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 9.5, letterSpacing: '.1em', textTransform: 'uppercase', color: '#525a66', fontWeight: 700 }}>链路</div>
          <StatusRow label="国内" up={domestic.up} latency={domestic.avgLatencyMs} accent="#3fb950" />
          <StatusRow label="国际" up={international.up} latency={international.avgLatencyMs} accent="#9b8cfa" />
        </div>

        <div style={{ height: 1, background: 'rgba(255,255,255,.07)' }} />

        {/* Override status row */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 9.5, letterSpacing: '.1em', textTransform: 'uppercase', color: '#525a66', fontWeight: 700 }}>
            强制手动设置代理
          </div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 10px', borderRadius: 8,
            background: hasProxy ? 'rgba(217,165,49,.07)' : 'rgba(255,255,255,.03)',
            border: `1px solid ${hasProxy ? 'rgba(217,165,49,.25)' : 'rgba(255,255,255,.07)'}`,
          }}>
            <span style={{
              width: 7, height: 7, borderRadius: '50%', flex: 'none',
              background: hasProxy ? '#d9a531' : '#4b5563',
              boxShadow: hasProxy ? '0 0 6px rgba(217,165,49,.5)' : 'none',
            }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 9, color: hasProxy ? '#d9a531' : '#525a66', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 2 }}>
                {hasProxy ? 'OVERRIDE 生效中' : '未覆盖'}
              </div>
              <div style={{
                fontSize: 10, fontFamily: '"JetBrains Mono",monospace',
                color: hasProxy ? '#c9a04a' : '#3d4550',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }} title={hasProxy ? status!.proxyUrl : undefined}>
                {hasProxy ? status!.proxyUrl : '使用默认路径'}
              </div>
            </div>
            <button
              onClick={openModal}
              style={{
                padding: '4px 10px', borderRadius: 6,
                border: '1px solid rgba(255,255,255,.12)',
                background: 'rgba(255,255,255,.05)', color: '#aab4c2',
                fontSize: 11, fontWeight: 600, cursor: 'pointer',
                fontFamily: 'inherit', flex: 'none',
              }}
            >
              设置
            </button>
          </div>
        </div>

        <div style={{ flex: 1 }} />

        {/* Probe button */}
        <button
          onClick={onProbe}
          disabled={probing}
          style={{
            padding: '8px 6px', borderRadius: 8,
            border: '1px solid rgba(255,255,255,.12)',
            background: 'rgba(255,255,255,.03)', color: '#cdd6e1',
            fontSize: 11.5, fontWeight: 600,
            cursor: probing ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit', opacity: probing ? 0.6 : 1,
          }}
        >
          ◎ 立即探测
        </button>
      </div>

      {/* Override modal */}
      {showModal && (
        <div
          onClick={e => { if (e.target === e.currentTarget) setShowModal(false); }}
          style={{
            position: 'fixed', inset: 0, zIndex: 100,
            background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div style={{
            width: 380, background: '#13181f',
            border: '1px solid rgba(217,165,49,.25)',
            borderRadius: 14, overflow: 'hidden',
            boxShadow: '0 24px 60px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.04)',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '14px 18px 12px',
              borderBottom: '1px solid rgba(255,255,255,.07)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#e9eef4' }}>强制手动设置代理</span>
                <span style={{
                  fontSize: 8.5, padding: '2px 6px', borderRadius: 4,
                  background: 'rgba(217,165,49,.15)', border: '1px solid rgba(217,165,49,.3)',
                  color: '#d9a531', fontWeight: 700, letterSpacing: '.05em',
                }}>OVERRIDE</span>
              </div>
              <button
                onClick={() => setShowModal(false)}
                style={{
                  width: 24, height: 24, borderRadius: 6, border: 'none',
                  background: 'rgba(255,255,255,.06)', color: '#6b7482',
                  fontSize: 14, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >×</button>
            </div>

            <div style={{ padding: '16px 18px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 12, color: '#6b7482', lineHeight: 1.5 }}>
                覆盖现有配置，强制将探测路径指向指定代理地址。留空并确认则清除覆盖，恢复默认。
              </div>
              <input
                autoFocus
                value={modalUrl}
                onChange={e => setModalUrl(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setShowModal(false); }}
                placeholder="http://127.0.0.1:7890"
                style={{
                  width: '100%', boxSizing: 'border-box',
                  padding: '9px 12px', borderRadius: 8,
                  background: '#0c1016', border: '1px solid rgba(255,255,255,.14)',
                  color: '#e6edf3', fontSize: 12, fontFamily: '"JetBrains Mono",monospace',
                  outline: 'none',
                }}
              />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                {hasProxy && (
                  <button
                    onClick={handleClear}
                    disabled={saving}
                    style={{
                      padding: '8px 14px', borderRadius: 7,
                      border: '1px solid rgba(255,255,255,.1)',
                      background: 'transparent', color: '#6b7482',
                      fontSize: 12, fontWeight: 600,
                      cursor: saving ? 'not-allowed' : 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >清除覆盖</button>
                )}
                <button
                  onClick={() => setShowModal(false)}
                  style={{
                    padding: '8px 14px', borderRadius: 7,
                    border: '1px solid rgba(255,255,255,.1)',
                    background: 'transparent', color: '#8b98a9',
                    fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >取消</button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  style={{
                    padding: '8px 16px', borderRadius: 7,
                    border: `1px solid ${saved ? 'rgba(63,185,80,.4)' : 'rgba(217,165,49,.4)'}`,
                    background: saved ? 'rgba(63,185,80,.15)' : 'rgba(217,165,49,.15)',
                    color: saved ? '#3fb950' : '#d9a531',
                    fontSize: 12, fontWeight: 700,
                    cursor: saving ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit', transition: 'all .15s',
                  }}
                >
                  {saved ? '✓ 已生效' : saving ? '…' : '强制覆盖'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

type PingResult = Record<string, Record<string, { up: boolean; latencyMs: number; probedAt: number }>>;

// ---- Main NetworkPage ----
export function NetworkPage() {
  const [range, setRange] = React.useState('1h');
  const [data, setData] = React.useState<NetworkData | null>(null);
  const [ping, setPing] = React.useState<PingResult | null>(null); // 实时探测结果（不入库）
  const [probing, setProbing] = React.useState(false);
  const [, tick] = React.useState(0);
  const toast = useToast();

  const fetchData = React.useCallback(async (r: string) => {
    try {
      const result = await api.getNetworkData(r);
      setData(result);
    } catch {
      // ignore errors silently
    }
  }, []);

  // Initial fetch + on range change
  React.useEffect(() => {
    fetchData(range);
  }, [range, fetchData]);

  // Auto-refresh every 60 seconds (background DB data)
  React.useEffect(() => {
    const t = setInterval(() => fetchData(range), 60_000);
    return () => clearInterval(t);
  }, [range, fetchData]);

  // 前台实时 ping：页面可见时每 10s 探一次，结果不入库，仅覆盖当前显示的延迟和状态
  React.useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    let alive = true;

    const runPing = async () => {
      if (!alive) return;
      try {
        const result = await api.pingNetwork();
        if (alive) setPing(result);
      } catch { /* ignore */ }
    };

    const start = () => {
      if (timer) return;
      runPing(); // 立即跑一次
      timer = setInterval(runPing, 10_000);
    };
    const stop = () => {
      if (timer) { clearInterval(timer); timer = null; }
    };

    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', onVisibility);
    if (!document.hidden) start();

    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
    };
  }, []); // 只挂一次，ping 本身不依赖 range

  // Tick for fmtAgo
  React.useEffect(() => {
    const t = setInterval(() => tick(x => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const handleProbe = async () => {
    setProbing(true);
    try {
      await api.probeNetwork();
      toast.push('已重新探测全部链路');
      // Refresh after a short delay to get new data
      setTimeout(() => fetchData(range), 1500);
    } catch {
      toast.push('探测请求失败');
    } finally {
      setProbing(false);
    }
  };

  const rangeInfo = NET_RANGES.find(r => r.key === range) ?? NET_RANGES[0];

  // Empty state / loading
  if (!data) {
    return (
      <div style={{
        width: '100%', height: '100%', background: '#0b0e14',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#525a66', fontSize: 14, fontFamily: 'system-ui,sans-serif',
      }}>
        正在加载网络数据…
      </div>
    );
  }

  const allT = [...data.direct, ...data.proxy];
  const overall = allT.length > 0 ? allT.reduce((a, t) => a + t.avail, 0) / allT.length : 0;
  const onN = allT.filter(t => t.up).length;
  const avg = (arr: number[]) => { const v = arr.filter(x => x > 0); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : 0; };
  const dAvg = avg(data.lineDomestic);
  const pAvg = avg(data.lineInternational);

  // 将实时 ping 结果覆盖到目标的当前状态（不影响历史桶和可用率）
  const applyPing = (targets: typeof data.direct, path: 'direct' | 'proxy') =>
    targets.map(t => {
      const live = ping?.[path]?.[t.id];
      return live ? { ...t, up: live.up, latencyMs: live.latencyMs, probedAt: live.probedAt } : t;
    });

  const domestic      = applyPing(data.direct.filter(t => t.group === 'domestic'),      'direct');
  const international = applyPing(data.proxy.filter(t => t.group === 'international'),  'proxy');

  // 国内/国际链路状态：从已应用 ping 的目标实时计算，不读 DB
  const linkStats = (targets: typeof domestic): LinkStats => {
    const up = targets.filter(t => t.up);
    return {
      up: up.length > 0,
      avgLatencyMs: up.length ? Math.round(up.reduce((s, t) => s + t.latencyMs, 0) / up.length) : 0,
    };
  };

  return (
    <div style={{
      width: '100%', height: '100%',
      background: '#0b0e14', color: '#e6edf3', fontFamily: 'system-ui,sans-serif',
      display: 'flex', gap: 16, padding: 20, boxSizing: 'border-box', overflow: 'hidden',
    }}>
      {/* Left sidebar */}
      <NetworkSidebar
        onProbe={handleProbe}
        probing={probing}
        domestic={linkStats(domestic)}
        international={linkStats(international)}
      />

      {/* 2×2 grid */}
      <div style={{
        flex: 1, minWidth: 0,
        display: 'grid',
        gridTemplateColumns: '1fr 2fr',
        gridTemplateRows: '1fr 1fr',
        gap: 14,
      }}>

        {/* Top-left: 国内连通性 (direct path) */}
        <NetRegionCard
          title="国内连通性" sub="DOMESTIC"
          accent="#3fb950" path="direct"
          targets={domestic} ticks={rangeInfo.ticks}
        />

        {/* Top-right: 概览 + 时间范围 */}
        <SummaryCard
          overall={overall} dAvg={dAvg} pAvg={pAvg}
          onN={onN} totalN={allT.length}
          probedAt={data.probedAt}
          range={range} onRangeChange={setRange}
        />

        {/* Bottom-left: 国际连通性 (proxy path) */}
        <NetRegionCard
          title="国际连通性" sub="INTERNATIONAL"
          accent="#9b8cfa" path="proxy"
          targets={international} ticks={rangeInfo.ticks}
        />

        {/* Bottom-right: 延迟对比图表 */}
        <div style={{
          background: '#10151d', border: '1px solid rgba(255,255,255,.07)',
          borderRadius: 16, padding: '14px 16px 10px',
          display: 'flex', flexDirection: 'column', minHeight: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6, flex: 'none' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#e9eef4' }}>延迟对比</span>
            <div style={{ display: 'flex', gap: 14, marginLeft: 'auto' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: '#aab4c2' }}>
                <span style={{ width: 12, height: 3, borderRadius: 2, background: '#3fb950' }} />国内
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: '#aab4c2' }}>
                <span style={{ width: 12, height: 3, borderRadius: 2, background: '#9b8cfa' }} />国际
              </span>
              <span style={{ fontSize: 10.5, color: '#525a66', fontFamily: '"JetBrains Mono",monospace' }}>ms</span>
            </div>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <NetLineChart lineDirect={data.lineDomestic} lineProxy={data.lineInternational} ticks={rangeInfo.ticks} />
          </div>
        </div>

      </div>

      <ToastStack items={toast.items} />
    </div>
  );
}
