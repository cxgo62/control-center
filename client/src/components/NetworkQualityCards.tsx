import React from 'react';
import type { LatencyBucket, LatencySeries, NetworkRange, VpsLineResponse, VpsTcpState } from '../types.js';
import { fmtAgo } from './Shared.js';
import {
  buildLatencyTooltipRows,
  buildVpsTooltip,
  clampTooltipCenterX,
  formatBucketInterval,
  latencyBucketIndexAtX,
  latencyChartMaximum,
  latencyPath,
  packetLossColor,
} from './network-chart-utils.js';

const MONO = '"JetBrains Mono",monospace';
const CARD = {
  background: '#10151d',
  border: '1px solid rgba(255,255,255,.07)',
  borderRadius: 16,
} as const;
const CHART_HEIGHT = 190;
const PAD_LEFT = 40;
const PAD_RIGHT = 12;
const PAD_TOP = 14;
const PAD_BOTTOM = 24;

const RANGE_OPTIONS: Array<{ key: NetworkRange; label: string }> = [
  { key: '1h', label: '1 小时' },
  { key: '6h', label: '6 小时' },
  { key: '24h', label: '24 小时' },
  { key: '7d', label: '7 天' },
];

function useWidth(initial = 760): [React.RefObject<HTMLDivElement>, number] {
  const ref = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(initial);
  React.useEffect(() => {
    if (!ref.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) setWidth(entry.contentRect.width);
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

function numberText(value: number | null, unit = ''): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const rounded = Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10);
  return `${rounded}${unit}`;
}

function timestampTick(timestamp: number | undefined): string {
  if (timestamp === undefined || !Number.isFinite(timestamp)) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(timestamp);
}

function chartBucketCount(series: readonly LatencySeries[]): number {
  return Math.max(0, ...series.map(item => item.buckets.length));
}

function bucketCenterX(index: number, count: number, innerWidth: number): number {
  return PAD_LEFT + ((index + 0.5) / Math.max(1, count)) * innerWidth;
}

function TooltipShell({ left, children, width = 250 }: { left: number; children: React.ReactNode; width?: number }) {
  return (
    <div onMouseMove={event => event.stopPropagation()} style={{
      position: 'absolute', left, top: 10, transform: 'translateX(-50%)', width,
      boxSizing: 'border-box', pointerEvents: 'auto', zIndex: 4,
      background: '#252d3b', border: '1px solid rgba(255,255,255,.16)', borderRadius: 8,
      padding: '9px 11px', color: '#e6edf3', fontSize: 10.5, lineHeight: 1.45,
      fontFamily: MONO, boxShadow: '0 10px 24px rgba(0,0,0,.42)',
      maxHeight: 'calc(100% - 20px)', overflowY: 'auto',
    }}>{children}</div>
  );
}

export function NetworkStatusBar({
  overall, online, total, domesticAverage, internationalAverage, probedAt, range, onRangeChange,
}: {
  overall: number;
  online: number;
  total: number;
  domesticAverage: number | null;
  internationalAverage: number | null;
  probedAt: number;
  range: NetworkRange;
  onRangeChange: (range: NetworkRange) => void;
}) {
  const metrics = [
    { label: '整体可用率', value: `${overall.toFixed(1)}%`, color: overall >= 99.5 ? '#3fb950' : overall >= 93 ? '#d9a531' : '#f15a4a' },
    { label: '在线', value: `${online}/${total}`, color: online === total ? '#3fb950' : '#d9a531' },
    { label: '国内均值', value: numberText(domesticAverage, 'ms'), color: '#3fb950' },
    { label: '国际均值', value: numberText(internationalAverage, 'ms'), color: '#9b8cfa' },
  ];
  return (
    <div style={{
      ...CARD, gridColumn: '1 / -1', minHeight: 46, padding: '6px 10px 6px 14px', boxSizing: 'border-box',
      display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap', overflow: 'hidden',
    }}>
      {metrics.map(metric => (
        <div key={metric.label} style={{ display: 'flex', alignItems: 'baseline', gap: 6, whiteSpace: 'nowrap' }}>
          <span style={{ fontSize: 9, color: '#5d6673', letterSpacing: '.07em' }}>{metric.label}</span>
          <span style={{ fontSize: 13, fontWeight: 800, color: metric.color, fontFamily: MONO }}>{metric.value}</span>
        </div>
      ))}
      <span style={{ fontSize: 9.5, color: '#5d6673', fontFamily: MONO, whiteSpace: 'nowrap' }}>
        探测于 {fmtAgo(probedAt)}
      </span>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 2, padding: 2, borderRadius: 8, flex: 'none', background: '#0c1016', border: '1px solid rgba(255,255,255,.08)' }}>
        {RANGE_OPTIONS.map(option => (
          <button key={option.key} onClick={() => onRangeChange(option.key)} style={{
            padding: '3px 8px', borderRadius: 6, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            fontSize: 10.5, fontWeight: 600, background: range === option.key ? 'rgba(90,160,250,.18)' : 'transparent',
            color: range === option.key ? '#7fb4ff' : '#6b7482',
          }}>{option.label}</button>
        ))}
      </div>
    </div>
  );
}

export function GenericLatencyChart({ series }: { series: readonly LatencySeries[] }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = React.useState<{ index: number; pointerX: number } | null>(null);
  const innerWidth = Math.max(60, width - PAD_LEFT - PAD_RIGHT);
  const innerHeight = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;
  const count = chartBucketCount(series);
  const maximum = latencyChartMaximum(series);
  const x = (index: number) => bucketCenterX(index, count, innerWidth);
  const y = (value: number) => PAD_TOP + innerHeight - (value / maximum) * innerHeight;
  const hoveredBucket = hover
    ? series.map(item => item.buckets[hover.index]).find(bucket => bucket !== undefined)
    : undefined;
  const tooltipRows = hover ? buildLatencyTooltipRows(series, hover.index) : [];
  const tooltipWidth = Math.min(250, Math.max(180, width - 16));
  const tooltipLeft = hover ? clampTooltipCenterX(hover.pointerX, tooltipWidth, width, 8) : 0;

  const onMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!count) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const pointerX = event.clientX - bounds.left;
    setHover({
      index: latencyBucketIndexAtX(pointerX, bounds.width, PAD_LEFT, PAD_RIGHT, count),
      pointerX,
    });
  };

  const tickIndexes = count ? [0, Math.floor((count - 1) / 2), count - 1] : [];
  return (
    <div style={{ ...CARD, padding: '12px 16px 8px', display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 4, flex: 'none' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#e9eef4', whiteSpace: 'nowrap' }}>延迟对比</span>
        <div style={{ marginLeft: 'auto', display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', gap: '4px 12px' }}>
          {series.map(item => (
            <span key={item.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: '#aab4c2' }}>
              <span style={{ width: 11, height: 3, borderRadius: 2, background: item.color }} />{item.label}
            </span>
          ))}
          <span style={{ fontSize: 10, color: '#525a66', fontFamily: MONO }}>ms</span>
        </div>
      </div>
      <div
        ref={ref}
        onMouseMove={onMouseMove}
        onMouseLeave={() => setHover(null)}
        style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden' }}
      >
        <svg width={width} height={CHART_HEIGHT} style={{ display: 'block' }}>
          {[0, .25, .5, .75, 1].map(step => {
            const gridY = PAD_TOP + innerHeight - step * innerHeight;
            return <g key={step}>
              <line x1={PAD_LEFT} y1={gridY} x2={width - PAD_RIGHT} y2={gridY} stroke="rgba(255,255,255,.055)" />
              <text x={PAD_LEFT - 7} y={gridY + 3.5} textAnchor="end" fontSize="10" fill="#525a66" fontFamily={MONO}>{Math.round(step * maximum)}</text>
            </g>;
          })}
          {series.map(item => (
            <path key={item.id} d={latencyPath(item.buckets, x, y)} fill="none" stroke={item.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {hover && <line x1={x(hover.index)} y1={PAD_TOP} x2={x(hover.index)} y2={PAD_TOP + innerHeight} stroke="rgba(230,237,243,.45)" strokeDasharray="3 3" />}
          {tickIndexes.map((index, position) => {
            const bucket = series.map(item => item.buckets[index]).find(value => value !== undefined);
            return <text key={`${index}-${position}`} x={x(index)} y={CHART_HEIGHT - 5}
              textAnchor={position === 0 ? 'start' : position === tickIndexes.length - 1 ? 'end' : 'middle'}
              fontSize="9.5" fill="#525a66" fontFamily={MONO}>{timestampTick(bucket?.startAt)}</text>;
          })}
        </svg>
        {!count && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#596270', fontSize: 11 }}>暂无延迟序列</div>}
        {hover && hoveredBucket && (
          <TooltipShell left={tooltipLeft} width={tooltipWidth}>
            <div style={{ color: '#9aa5b3', marginBottom: 5 }}>{formatBucketInterval(hoveredBucket.startAt, hoveredBucket.endAt)}</div>
            {tooltipRows.map(row => (
              <div key={row.id} style={{ display: 'grid', gridTemplateColumns: '8px minmax(0,1fr) auto', alignItems: 'center', gap: 7 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: row.color }} />
                <span style={{ color: '#b7c0cc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.label}</span>
                <span style={{ color: row.value === '无数据' ? '#687382' : '#e6edf3', fontWeight: 700 }}>{row.value}</span>
              </div>
            ))}
          </TooltipShell>
        )}
      </div>
    </div>
  );
}

const QUALITY_TONE = {
  good: '#3fb950', degraded: '#d9a531', poor: '#f15a4a', collecting: '#7fb4ff',
  'ping-unavailable': '#d9a531', unavailable: '#687382',
} as const;

function tcpLabel(state: VpsTcpState): string {
  return state === 'up' ? '正常' : state === 'down' ? '失败' : state === 'intermittent' ? '间歇异常' : '无数据';
}

function VpsEmptyState({ title, detail, tone = '#687382' }: { title: string; detail?: string; tone?: string }) {
  return <div style={{ flex: 1, minHeight: 130, display: 'grid', placeItems: 'center', textAlign: 'center', padding: 18 }}>
    <div>
      <div style={{ color: tone, fontSize: 13, fontWeight: 700 }}>{title}</div>
      {detail && <div style={{ color: '#596270', fontSize: 10.5, marginTop: 6 }}>{detail}</div>}
    </div>
  </div>;
}

export function VpsLineCard({ response }: { response: VpsLineResponse | null }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = React.useState<{ index: number; pointerX: number } | null>(null);
  const measured = response?.status === 'available' || response?.status === 'accumulating' ? response : null;
  const qualityTone = measured ? QUALITY_TONE[measured.quality.state] : '#687382';

  if (!response) {
    return <div style={{ ...CARD, padding: '13px 16px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#e9eef4' }}>搬瓦工私人线路</div>
      <VpsEmptyState title="正在加载线路状态…" />
    </div>;
  }
  if (response.status === 'unconfigured') {
    return <div style={{ ...CARD, padding: '13px 16px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#e9eef4' }}>{response.displayLabel}</div>
      <VpsEmptyState title={response.message} detail="设置 VPS_LINE_NODE_NAME 后由服务端发现节点" tone="#d9a531" />
    </div>;
  }
  if (response.status === 'unresolved') {
    return <div style={{ ...CARD, padding: '13px 16px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#e9eef4' }}>{response.displayLabel}</div>
      <VpsEmptyState title={response.message} detail="节点名必须与 Clash Verge 配置完全一致" tone="#f15a4a" />
    </div>;
  }
  if (response.status === 'error') {
    return <div style={{ ...CARD, padding: '13px 16px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#e9eef4' }}>{response.displayLabel}</div>
      <VpsEmptyState title={response.error.message} detail="其他网络卡片不受影响" tone="#f15a4a" />
    </div>;
  }

  const lineData = response;
  const buckets = lineData.buckets;
  const count = buckets.length;
  const innerWidth = Math.max(60, width - PAD_LEFT - PAD_RIGHT);
  const latencyHeight = 112;
  const yMaximum = Math.max(40, Math.ceil((Math.max(0, ...buckets.flatMap(bucket => bucket.hasData && bucket.medianLatencyMs !== null ? [bucket.medianLatencyMs] : [])) * 1.2) / 20) * 20);
  const x = (index: number) => bucketCenterX(index, count, innerWidth);
  const y = (value: number) => PAD_TOP + latencyHeight - (value / yMaximum) * latencyHeight;
  const latencyBuckets: LatencyBucket[] = buckets.map(bucket => ({
    startAt: bucket.startAt, endAt: bucket.endAt, hasData: bucket.hasData, latencyMs: bucket.medianLatencyMs,
  }));
  const bandY = PAD_TOP + latencyHeight + 18;
  const bandHeight = 10;
  const tooltip = hover ? buildVpsTooltip(buckets[hover.index]) : null;
  const tooltipWidth = Math.min(272, Math.max(180, width - 16));
  const tooltipLeft = hover ? clampTooltipCenterX(hover.pointerX, tooltipWidth, width, 8) : 0;

  const onMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!count) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const pointerX = event.clientX - bounds.left;
    setHover({ index: latencyBucketIndexAtX(pointerX, bounds.width, PAD_LEFT, PAD_RIGHT, count), pointerX });
  };
  const metrics = [
    { label: '当前中位延迟', value: numberText(lineData.current.medianLatencyMs, 'ms'), color: '#c5baff' },
    { label: '所选区间丢包', value: numberText(lineData.rangeSummary.lossPercent, '%'), color: lineData.rangeSummary.lossPercent === null ? '#687382' : packetLossColor(lineData.rangeSummary.lossPercent) },
    { label: '当前抖动', value: numberText(lineData.current.jitterMs, 'ms'), color: '#cdd6e1' },
    { label: '当前 TCP', value: tcpLabel(lineData.current.tcpState), color: lineData.current.tcpState === 'up' ? '#3fb950' : lineData.current.tcpState === 'down' ? '#f15a4a' : '#687382' },
  ];

  return (
    <div style={{ ...CARD, padding: '12px 16px 8px', display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}>
        <span style={{ width: 3, height: 24, borderRadius: 2, background: '#9b8cfa' }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#e9eef4' }}>{lineData.displayLabel}</div>
          <div style={{ fontSize: 9.5, color: lineData.current.probedAt ? '#596270' : qualityTone, fontFamily: MONO, marginTop: 1 }}>
            {lineData.current.probedAt ? `探测于 ${fmtAgo(lineData.current.probedAt)}` : '等待首次探测'}
          </div>
        </div>
        <span style={{ marginLeft: 'auto', color: qualityTone, fontSize: 10.5, fontWeight: 800, border: `1px solid ${qualityTone}55`, background: `${qualityTone}12`, borderRadius: 999, padding: '3px 8px', textAlign: 'right' }}>
          {lineData.quality.label}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: width < 480 ? 'repeat(2,minmax(0,1fr))' : 'repeat(4,minmax(0,1fr))', gap: 6, marginBottom: 4 }}>
        {metrics.map(metric => <div key={metric.label} style={{ minWidth: 0, padding: '6px 7px', borderRadius: 7, background: 'rgba(255,255,255,.025)', border: '1px solid rgba(255,255,255,.05)' }}>
          <div style={{ color: '#596270', fontSize: 8, marginBottom: 3, whiteSpace: 'nowrap' }}>{metric.label}</div>
          <div style={{ color: metric.color, fontFamily: MONO, fontSize: 11.5, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{metric.value}</div>
        </div>)}
      </div>
      <div ref={ref} onMouseMove={onMouseMove} onMouseLeave={() => setHover(null)} style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <svg width={width} height={CHART_HEIGHT} style={{ display: 'block' }}>
          {[0, .5, 1].map(step => {
            const gridY = PAD_TOP + latencyHeight - step * latencyHeight;
            return <g key={step}>
              <line x1={PAD_LEFT} y1={gridY} x2={width - PAD_RIGHT} y2={gridY} stroke="rgba(255,255,255,.055)" />
              <text x={PAD_LEFT - 7} y={gridY + 3} textAnchor="end" fontSize="9" fill="#525a66" fontFamily={MONO}>{Math.round(step * yMaximum)}</text>
            </g>;
          })}
          <path d={latencyPath(latencyBuckets, x, y)} fill="none" stroke="#9b8cfa" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          <text x={PAD_LEFT - 7} y={bandY + bandHeight - 1} textAnchor="end" fontSize="8" fill="#525a66" fontFamily={MONO}>loss</text>
          {buckets.map((bucket, index) => {
            const segmentWidth = innerWidth / Math.max(1, count);
            return <rect key={bucket.startAt} x={PAD_LEFT + index * segmentWidth} y={bandY} width={segmentWidth + .4} height={bandHeight} fill={packetLossColor(bucket.hasData ? bucket.lossPercent : null)} />;
          })}
          {hover && <line x1={x(hover.index)} y1={PAD_TOP} x2={x(hover.index)} y2={bandY + bandHeight} stroke="rgba(230,237,243,.55)" strokeDasharray="3 3" />}
          {[0, Math.floor((count - 1) / 2), count - 1].filter(index => index >= 0).map((index, position, values) => (
            <text key={`${index}-${position}`} x={x(index)} y={CHART_HEIGHT - 5}
              textAnchor={position === 0 ? 'start' : position === values.length - 1 ? 'end' : 'middle'}
              fontSize="9" fill="#525a66" fontFamily={MONO}>{timestampTick(buckets[index]?.startAt)}</text>
          ))}
        </svg>
        {tooltip && hover && <TooltipShell left={tooltipLeft} width={tooltipWidth}>
          <div style={{ color: '#9aa5b3', marginBottom: 5 }}>{tooltip.interval}</div>
          {'message' in tooltip ? <div style={{ color: '#687382' }}>{tooltip.message}</div> : <>
            {[
              ['中位延迟', tooltip.medianLatency], ['P95 延迟', tooltip.p95Latency],
              ['丢包率', tooltip.lossPercent], ['丢失 / 发送', tooltip.lostSent],
              ['抖动', tooltip.jitter], ['TCP', tcpLabel(tooltip.tcp)],
            ].map(([label, value]) => <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 14 }}>
              <span style={{ color: '#8b96a5' }}>{label}</span><span style={{ color: '#e6edf3', fontWeight: 700 }}>{value}</span>
            </div>)}
          </>}
        </TooltipShell>}
      </div>
    </div>
  );
}
