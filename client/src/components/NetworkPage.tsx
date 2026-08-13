import React from 'react';
import type { NetDest, NetBucket, NetworkRange, VpsLineResponse } from '../types.js';
import { api, type ClashStatus, type KiwiVmTrafficResponse, type KiwiVmTrafficSuccess } from '../api.js';
import { StatusDot, ToastStack, useToast, fmtAgo } from './Shared.js';
import { cardHoverPosition, formatBucketTooltip } from './uptime-bar-tooltip.js';
import { formatShanghaiResetTime, formatTrafficBytes, formatUsagePercent } from './kiwivm-format.js';
import { averageLatencyForSeries, shouldCommitLatestRequest, shouldCommitRangeResponse } from './network-chart-utils.js';
import { GenericLatencyChart, NetworkStatusBar, VpsLineCard } from './NetworkQualityCards.js';
import { useElementWidth } from './use-element-width.js';
import {
  beginNetworkDataRequest,
  completeNetworkDataRequest,
  failNetworkDataRequest,
  initialNetworkDataState,
  networkDataStatusMessage,
} from './network-data-state.js';

const NET_RANGES = [
  { key: '1h',  label: '1 小时',  ticks: ['-60分', '-45分', '-30分', '-15分', '现在'] },
  { key: '6h',  label: '6 小时',  ticks: ['-6时',  '-4.5时', '-3时',  '-1.5时', '现在'] },
  { key: '24h', label: '24 小时', ticks: ['-24时', '-18时',  '-12时', '-6时',   '现在'] },
  { key: '7d',  label: '7 天',    ticks: ['-7天',  '-5天',   '-3天',  '-1天',   '现在'] },
];

function availColor(a: number): string {
  return a >= 99.5 ? '#3fb950' : a >= 98 ? '#7bcf4f' : a >= 93 ? '#d9a531' : '#f15a4a';
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

      {/* 色带与整卡 hover 时间轴共用同一宽度 */}
      <div style={{ width: '100%' }}>
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

// ---- Proxy status types ----
interface ProxyStatus {
  proxyUrl: string;
  hasProxy: boolean;
  direct: { up: boolean; avgLatencyMs: number };
  proxy:  { up: boolean; avgLatencyMs: number };
  lastProbedAt: number | null;
}

// ---- Network sidebar ----
interface LinkStats { up: boolean; avgLatencyMs: number; }

const KIWI_SEVERITY = {
  normal: { label: '正常', color: '#3fb950' },
  notice: { label: '提醒', color: '#d9a531' },
  warning: { label: '警告', color: '#e58b3a' },
  critical: { label: '严重', color: '#f15a4a' },
} as const;

function KiwiVmSuccessCard({ data }: { data: KiwiVmTrafficSuccess }) {
  const severity = KIWI_SEVERITY[data.severity];
  const progress = Math.min(Math.max(data.usagePercent, 0), 100);
  const metrics = [
    { label: '已使用', value: formatTrafficBytes(data.usedBytes), color: severity.color },
    { label: '套餐总量', value: formatTrafficBytes(data.totalBytes), color: '#cdd6e1' },
    { label: '剩余', value: formatTrafficBytes(data.remainingBytes), color: '#7fb4ff' },
  ];

  return (
    <div style={{
      borderRadius: 10,
      border: `1px solid ${severity.color}38`,
      background: `${severity.color}0d`,
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        padding: '8px 11px 7px', borderBottom: '1px solid rgba(255,255,255,.06)',
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#7fb4ff', letterSpacing: '.04em' }}>搬瓦工 · KiwiVM</div>
          <div style={{ fontSize: 9.5, color: '#687382', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }} title={`${data.hostname} · ${data.location}`}>
            {data.hostname} · {data.location}
          </div>
        </div>
        <span style={{
          flex: 'none', fontSize: 9, fontWeight: 800, color: severity.color,
          border: `1px solid ${severity.color}55`, background: `${severity.color}16`,
          borderRadius: 999, padding: '2px 7px',
        }}>{severity.label}</span>
      </div>

      <div style={{ padding: '9px 11px 10px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
          <span style={{ fontSize: 9, color: '#687382', letterSpacing: '.07em' }}>本周期使用率</span>
          <span style={{ fontSize: 12, fontWeight: 800, color: severity.color, fontFamily: '"JetBrains Mono",monospace' }}>
            {formatUsagePercent(data.usagePercent)}
          </span>
        </div>
        <div style={{ height: 5, borderRadius: 999, overflow: 'hidden', background: 'rgba(255,255,255,.08)' }}>
          <div style={{ width: `${progress}%`, height: '100%', borderRadius: 999, background: severity.color, transition: 'width .25s ease' }} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginTop: 10 }}>
          {metrics.map(metric => (
            <div key={metric.label} style={{ minWidth: 0 }}>
              <div style={{ fontSize: 8.5, color: '#596270', marginBottom: 3 }}>{metric.label}</div>
              <div style={{
                fontSize: 9.5, fontWeight: 700, color: metric.color,
                fontFamily: '"JetBrains Mono",monospace', whiteSpace: 'nowrap',
              }}>{metric.value}</div>
            </div>
          ))}
        </div>

        <div style={{ height: 1, background: 'rgba(255,255,255,.06)', margin: '9px 0 7px' }} />
        <div style={{ fontSize: 8.5, color: '#596270', marginBottom: 3 }}>下次重置</div>
        <div style={{ fontSize: 9.5, color: '#9ba7b5', fontFamily: '"JetBrains Mono",monospace' }}>
          {formatShanghaiResetTime(data.nextResetAt)}
        </div>

        {(data.suspended || data.policyViolation) && (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {data.suspended && <div style={{ fontSize: 9.5, color: '#f15a4a', fontWeight: 700 }}>● VPS 已暂停</div>}
            {data.policyViolation && <div style={{ fontSize: 9.5, color: '#f15a4a', fontWeight: 700 }}>● 存在策略违规</div>}
          </div>
        )}
        {data.monthlyDataMultiplier !== 1 && (
          <div style={{ marginTop: 8, fontSize: 9, color: '#d9a531', lineHeight: 1.4 }}>
            计费倍率 ×{data.monthlyDataMultiplier} · 待与 KiwiVM 面板校准
          </div>
        )}
      </div>
    </div>
  );
}

function KiwiVmCard({ data }: { data: KiwiVmTrafficResponse | null }) {
  if (data?.configured && !('error' in data)) return <KiwiVmSuccessCard data={data} />;

  const isError = data?.configured === true && 'error' in data;
  return (
    <div style={{
      borderRadius: 10, padding: '9px 11px',
      border: `1px solid ${isError ? 'rgba(241,90,74,.25)' : 'rgba(90,160,250,.18)'}`,
      background: isError ? 'rgba(241,90,74,.05)' : 'rgba(90,160,250,.04)',
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#7fb4ff', letterSpacing: '.04em', marginBottom: 5 }}>
        搬瓦工 · KiwiVM
      </div>
      {data === null ? (
        <div style={{ fontSize: 10, color: '#687382' }}>正在加载流量状态…</div>
      ) : isError ? (
        <div style={{ fontSize: 10, color: '#f15a4a', lineHeight: 1.45 }}>{data.error.message}</div>
      ) : (
        <>
          <div style={{ fontSize: 10.5, color: '#d9a531', fontWeight: 700, marginBottom: 3 }}>待配置凭据</div>
          <div style={{ fontSize: 9.5, color: '#687382', fontFamily: '"JetBrains Mono",monospace' }}>.private/kiwivm.env</div>
        </>
      )}
    </div>
  );
}

interface NetworkSidebarProps {
  onProbe: () => void;
  probing: boolean;
  domestic: LinkStats;
  international: LinkStats;
}

function NetworkSidebar({ onProbe, probing, domestic, international }: NetworkSidebarProps) {
  const [status, setStatus] = React.useState<ProxyStatus | null>(null);
  const [clash, setClash] = React.useState<ClashStatus | null>(null);
  const [kiwiVm, setKiwiVm] = React.useState<KiwiVmTrafficResponse | null>(null);
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

  const fetchClash = React.useCallback(async () => {
    try {
      setClash(await api.getClashStatus());
    } catch {
      setClash({
        available: false,
        error: { code: 'CLASH_CONFIG_UNAVAILABLE', message: 'Clash Verge 配置不可用' },
      });
    }
  }, []);

  const fetchKiwiVm = React.useCallback(async () => {
    try {
      setKiwiVm(await api.getKiwiVmTraffic());
    } catch {
      setKiwiVm({
        configured: true,
        error: { code: 'KIWIVM_NETWORK_ERROR', message: '无法加载 KiwiVM 流量状态' },
      });
    }
  }, []);

  React.useEffect(() => { fetchStatus(); fetchClash(); fetchKiwiVm(); }, [fetchStatus, fetchClash, fetchKiwiVm]);
  React.useEffect(() => {
    const t = setInterval(fetchStatus, 30_000);
    return () => clearInterval(t);
  }, [fetchStatus]);
  React.useEffect(() => {
    const t = setInterval(fetchKiwiVm, 5 * 60_000);
    return () => clearInterval(t);
  }, [fetchKiwiVm]);

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
      <div className="network-sidebar" style={{
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

        {/* Clash Verge status block */}
        {clash?.available ? (
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
              <span style={{ fontSize: 11, fontWeight: 700, color: '#7fb4ff', letterSpacing: '.04em' }}>Clash Verge</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: 'rgba(255,255,255,.04)' }}>
              {[
                { label: 'TUN 模式', value: clash.tunEnabled ? '已开启' : '未开启', color: clash.tunEnabled ? '#3fb950' : '#d9a531' },
                { label: '协议栈',   value: clash.tunStack,                          color: '#cdd6e1' },
                { label: '代理端口', value: `:${clash.mixedPort}`,                  color: '#9b8cfa' },
                { label: '路由模式', value: clash.mode,                             color: '#aab4c2' },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ padding: '8px 11px', background: '#10151d' }}>
                  <div style={{ fontSize: 9, color: '#525a66', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 3 }}>{label}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color, fontFamily: '"JetBrains Mono",monospace' }}>{value}</div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div style={{
            borderRadius: 10, padding: '9px 11px',
            border: '1px solid rgba(90,160,250,.18)', background: 'rgba(90,160,250,.04)',
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#7fb4ff', letterSpacing: '.04em', marginBottom: 4 }}>Clash Verge</div>
            <div style={{ fontSize: 10, color: clash ? '#d9a531' : '#687382' }}>
              {clash ? clash.error.message : '正在加载配置…'}
            </div>
          </div>
        )}

        <KiwiVmCard data={kiwiVm} />

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
  const [range, setRange] = React.useState<NetworkRange>('1h');
  const [networkDataState, setNetworkDataState] = React.useState(initialNetworkDataState);
  const { data, dataRange, error: dataError } = networkDataState;
  const [vpsLine, setVpsLine] = React.useState<VpsLineResponse | null>(null);
  const [ping, setPing] = React.useState<PingResult | null>(null); // 实时探测结果（不入库）
  const [probing, setProbing] = React.useState(false);
  const [, tick] = React.useState(0);
  const selectedRangeRef = React.useRef<NetworkRange>(range);
  const dataRequestIdRef = React.useRef(0);
  const vpsRequestIdRef = React.useRef(0);
  const [contentRef, contentWidth] = useElementWidth(900);
  selectedRangeRef.current = range;
  const toast = useToast();

  const fetchData = React.useCallback(async (r: NetworkRange) => {
    if (r !== selectedRangeRef.current) return;
    const requestId = ++dataRequestIdRef.current;
    setNetworkDataState(beginNetworkDataRequest);
    try {
      const result = await api.getNetworkData(r);
      if (shouldCommitRangeResponse(r, selectedRangeRef.current, requestId, dataRequestIdRef.current)) {
        setNetworkDataState(state => completeNetworkDataRequest(state, result, r));
      }
    } catch {
      if (shouldCommitRangeResponse(r, selectedRangeRef.current, requestId, dataRequestIdRef.current)) {
        setNetworkDataState(state => failNetworkDataRequest(state, '网络数据更新失败'));
      }
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

  // VPS data has a card-local lifecycle so a route/storage failure does not disturb the rest of the page.
  React.useEffect(() => {
    let alive = true;
    setVpsLine(null);
    const load = async () => {
      const requestId = ++vpsRequestIdRef.current;
      try {
        const response = await api.getVpsLine(range);
        if (shouldCommitLatestRequest(requestId, vpsRequestIdRef.current, alive)) setVpsLine(response);
      } catch {
        if (shouldCommitLatestRequest(requestId, vpsRequestIdRef.current, alive)) setVpsLine({
          status: 'error', displayLabel: '搬瓦工私人线路',
          error: { code: 'VPS_LINE_DATA_UNAVAILABLE', message: '线路数据暂时不可用' },
        });
      }
    };
    load();
    const timer = setInterval(load, 60_000);
    return () => {
      alive = false;
      ++vpsRequestIdRef.current;
      clearInterval(timer);
    };
  }, [range]);

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
      setTimeout(() => fetchData(selectedRangeRef.current), 1500);
    } catch {
      toast.push('探测请求失败');
    } finally {
      setProbing(false);
    }
  };

  const dataRangeInfo = NET_RANGES.find(r => r.key === dataRange) ?? NET_RANGES[0];
  const narrowContent = contentWidth < 760;

  // Empty state / loading
  if (!data) {
    return (
      <div style={{
        width: '100%', height: '100%', background: '#0b0e14',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#525a66', fontSize: 14, fontFamily: 'system-ui,sans-serif',
      }}>
        {dataError ? (
          <div role="alert" style={{ textAlign: 'center' }}>
            <div style={{ color: '#d9a531', marginBottom: 10 }}>{dataError}</div>
            <button type="button" onClick={() => fetchData(range)} style={{ border: '1px solid rgba(127,180,255,.35)', borderRadius: 7, background: 'rgba(90,160,250,.12)', color: '#7fb4ff', padding: '6px 12px', cursor: 'pointer' }}>重试</button>
          </div>
        ) : '正在加载网络数据…'}
      </div>
    );
  }

  const allT = [...data.direct, ...data.proxy];
  const overall = allT.length > 0 ? allT.reduce((a, t) => a + t.avail, 0) / allT.length : 0;
  const onN = allT.filter(t => t.up).length;
  const dAverage = averageLatencyForSeries(data.latencySeries, 'domestic');
  const iAverage = averageLatencyForSeries(data.latencySeries, 'international');
  const dAvg = dAverage === null ? null : Math.round(dAverage);
  const pAvg = iAverage === null ? null : Math.round(iAverage);

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
    <div className="network-page-shell" style={{
      width: '100%', height: '100%',
      background: '#0b0e14', color: '#e6edf3', fontFamily: 'system-ui,sans-serif',
      display: 'flex', gap: 16, padding: 20, boxSizing: 'border-box', overflow: 'hidden',
    }}>
      <style>{`
        @media (max-width: 820px) {
          .network-page-shell {
            flex-direction: column;
            overflow-y: auto !important;
            padding: 12px !important;
          }
          .network-sidebar {
            width: auto !important;
            overflow-y: visible !important;
          }
          .network-content {
            flex: none !important;
            overflow-y: visible !important;
            grid-template-columns: minmax(0, 1fr) !important;
            grid-template-rows: auto repeat(4, minmax(300px, auto)) !important;
          }
        }
        @media (max-width: 520px) {
          .network-page-shell { padding: 8px !important; gap: 10px !important; }
        }
      `}</style>
      {/* Left sidebar */}
      <NetworkSidebar
        onProbe={handleProbe}
        probing={probing}
        domestic={linkStats(domestic)}
        international={linkStats(international)}
      />

      {/* Compact status row + two content rows */}
      <div ref={contentRef} className="network-content" style={{
        flex: 1, minWidth: 0,
        display: 'grid',
        gridTemplateColumns: narrowContent ? 'minmax(0,1fr)' : 'minmax(260px,1fr) minmax(0,2fr)',
        gridTemplateRows: narrowContent ? 'auto repeat(4,minmax(300px,auto))' : 'auto minmax(0,1fr) minmax(0,1fr)',
        gap: 14,
        overflowY: narrowContent ? 'auto' : 'visible',
        paddingRight: narrowContent ? 4 : 0,
      }}>

        <NetworkStatusBar
          overall={overall} online={onN} total={allT.length}
          domesticAverage={dAvg} internationalAverage={pAvg}
          probedAt={data.probedAt} range={range} onRangeChange={setRange}
          statusMessage={networkDataStatusMessage(networkDataState, range)}
          error={dataError !== null} onRetry={() => fetchData(range)}
        />

        <NetRegionCard
          title="国内连通性" sub="DOMESTIC"
          accent="#3fb950" path="direct"
          targets={domestic} ticks={dataRangeInfo.ticks}
        />

        <VpsLineCard response={vpsLine} />

        <NetRegionCard
          title="国际连通性" sub="INTERNATIONAL"
          accent="#9b8cfa" path="proxy"
          targets={international} ticks={dataRangeInfo.ticks}
        />

        <GenericLatencyChart series={data.latencySeries} />

      </div>

      <ToastStack items={toast.items} />
    </div>
  );
}
