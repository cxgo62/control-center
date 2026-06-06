import React from 'react';
import type { ServiceInfo, Event, LogLine } from '../types.js';
import {
  CC_STATUS,
  StatusDot, StatusPill, StatusBar, ServiceActions,
  HealthRing, LogDrawer, ToastStack,
  useToast, fmtUptime, fmtAgo,
  type LogEntry,
} from './Shared.js';

// Group definitions (local since we can't import from config)
const CC_GROUPS: Record<string, { key: string; label: string; desc: string }> = {
  infra: { key: 'infra', label: '网络基建', desc: 'Infrastructure' },
  app:   { key: 'app',   label: '个人应用', desc: 'Personal Apps' },
};

function uptimeSec(svc: ServiceInfo): number {
  if (!svc.startedAt) return 0;
  return Math.floor((Date.now() - svc.startedAt) / 1000);
}

interface CCardProps {
  svc: ServiceInfo;
  onAction: (id: string, action: string) => void;
  onLogs: (svc: ServiceInfo, entry?: LogEntry) => void;
  onToast: (msg: string) => void;
}

function C_Card({ svc, onAction, onLogs, onToast }: CCardProps) {
  const m = CC_STATUS[svc.status] ?? CC_STATUS.stopped;
  const [hover, setHover] = React.useState(false);
  const hist = svc.statusHist ?? [];
  const upN = hist.filter(x => x === 'up').length;
  const runPct = hist.length ? Math.round((upN / hist.length) * 100) : 0;
  const barCol = runPct >= 99 ? '#3fb950' : runPct >= 90 ? '#7bcf4f' : runPct >= 50 ? '#d9a531' : '#f15a4a';

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: 'linear-gradient(180deg,#141a23,#11161e)',
        border: `1px solid ${hover ? 'rgba(255,255,255,.14)' : 'rgba(255,255,255,.07)'}`,
        borderRadius: 15, padding: '16px 17px 15px',
        display: 'flex', flexDirection: 'column', gap: 12,
        position: 'relative', overflow: 'hidden',
        transition: 'border-color .15s, transform .15s, box-shadow .15s',
        transform: hover ? 'translateY(-2px)' : 'none',
        boxShadow: hover ? '0 16px 36px rgba(0,0,0,.4)' : 'none',
      }}
    >
      {/* Top color stripe */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 2,
        background: `linear-gradient(90deg, ${m.color}, ${m.color}00 65%)`,
        opacity: hover ? 0.95 : 0.55, transition: 'opacity .15s',
      }} />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, position: 'relative' }}>
        <StatusDot status={svc.status} size={10} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15.5, fontWeight: 700, color: '#e9eef4', lineHeight: 1.15 }}>{svc.name}</div>
          <div style={{ fontSize: 11, color: '#6b7482', marginTop: 3, fontFamily: '"JetBrains Mono",monospace' }}>{svc.tech}</div>
        </div>
        <StatusPill status={svc.status} />
      </div>

      {/* Past 24h status bar */}
      <div style={{ padding: '4px 0 2px' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 7 }}>
          <span style={{ fontSize: 9.5, letterSpacing: '.12em', textTransform: 'uppercase', color: '#525a66', fontWeight: 700 }}>
            过去 24 小时
          </span>
          <span style={{ marginLeft: 'auto', fontSize: 11, fontFamily: '"JetBrains Mono",monospace', color: barCol, fontWeight: 600 }}>
            运行 {runPct}%
          </span>
        </div>
        <StatusBar hist={hist} height={26} />
        <div style={{
          display: 'flex', justifyContent: 'space-between', marginTop: 5,
          fontSize: 9.5, color: '#4b5563', fontFamily: '"JetBrains Mono",monospace',
        }}>
          <span>-24时</span><span>现在</span>
        </div>
      </div>

      {/* Metrics row */}
      <div style={{
        display: 'flex', gap: 16, padding: '11px 0',
        borderTop: '1px solid rgba(255,255,255,.05)',
        fontFamily: '"JetBrains Mono",monospace',
      }}>
        <div style={{ flex: 1.3, minWidth: 0 }}>
          <div style={{ fontSize: 9, letterSpacing: '.1em', textTransform: 'uppercase', color: '#525a66', fontWeight: 700, marginBottom: 3 }}>运行时长</div>
          <div style={{ fontSize: 12, color: svc.startedAt ? '#cdd6e1' : '#4b5563' }}>{fmtUptime(uptimeSec(svc))}</div>
        </div>
        <div style={{ flex: 0.7 }}>
          <div style={{ fontSize: 9, letterSpacing: '.1em', textTransform: 'uppercase', color: '#525a66', fontWeight: 700, marginBottom: 3 }}>端口</div>
          <div style={{ fontSize: 12, color: '#9aa5b3' }}>{svc.port}</div>
        </div>
        <div style={{ flex: 1.4, minWidth: 0 }}>
          <div style={{ fontSize: 9, letterSpacing: '.1em', textTransform: 'uppercase', color: '#525a66', fontWeight: 700, marginBottom: 3 }}>地址</div>
          <div style={{ fontSize: 12, color: '#9aa5b3', wordBreak: 'break-all' }}>{svc.addr}</div>
        </div>
      </div>

      <ServiceActions svc={svc} onAction={onAction} onLogs={onLogs} onToast={onToast} compact max={5} />
    </div>
  );
}

interface CSectionProps {
  group: string;
  items: ServiceInfo[];
  onAction: (id: string, action: string) => void;
  onLogs: (svc: ServiceInfo, entry?: LogEntry) => void;
  onToast: (msg: string) => void;
}

function C_Section({ group, items, onAction, onLogs, onToast }: CSectionProps) {
  const g = CC_GROUPS[group] ?? { label: group, desc: '' };
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 13 }}>
        <span style={{ width: 3, height: 14, borderRadius: 2, background: group === 'infra' ? '#5aa0fa' : '#3fb950' }} />
        <h2 style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: '#cdd6e1' }}>{g.label}</h2>
        <span style={{
          fontSize: 10.5, color: '#5b636f', fontFamily: '"JetBrains Mono",monospace',
          letterSpacing: '.08em', textTransform: 'uppercase',
        }}>{g.desc}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 14 }}>
        {items.map(s => (
          <C_Card key={s.id} svc={s} onAction={onAction} onLogs={onLogs} onToast={onToast} />
        ))}
      </div>
    </div>
  );
}

interface ServicesPageProps {
  services: ServiceInfo[];
  events: Event[];
  onAction: (id: string, action: string) => void;
  onFetchLogs: (id: string, file?: string) => Promise<LogLine[]>;
}

export function ServicesPage({ services, events, onAction, onFetchLogs }: ServicesPageProps) {
  const toast = useToast();
  const [logSvc, setLogSvc] = React.useState<ServiceInfo | null>(null);
  const [logLines, setLogLines] = React.useState<LogLine[]>([]);
  const [logEntry, setLogEntry] = React.useState<LogEntry | undefined>(undefined);
  const [, tick] = React.useState(0);

  // Tick every second to update uptime display
  React.useEffect(() => {
    const t = setInterval(() => tick(x => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const counts: Record<string, number> = { running: 0, paused: 0, stopped: 0, error: 0, restarting: 0 };
  services.forEach(s => { counts[s.status] = (counts[s.status] ?? 0) + 1; });
  const total = services.length;
  const pct = total > 0 ? counts.running / total : 0;
  const problem = counts.error ?? 0;
  const headColor = problem > 0 ? '#f15a4a' : ((counts.paused ?? 0) + (counts.stopped ?? 0)) > 0 ? '#d9a531' : '#3fb950';

  const infra = services.filter(s => s.group === 'infra');
  const app = services.filter(s => s.group === 'app');

  const handleOpenLogs = async (svc: ServiceInfo, entry?: LogEntry) => {
    setLogSvc(svc);
    setLogEntry(entry);
    setLogLines([]);
    try {
      const lines = await onFetchLogs(svc.id, entry?.file);
      setLogLines(lines);
    } catch {
      setLogLines([]);
    }
  };

  const handleProbeAll = () => {
    services.forEach(s => onAction(s.id, 'probe'));
    toast.push('已对全部服务发起健康探测');
  };

  return (
    <div style={{
      position: 'relative', width: '100%', height: '100%',
      background: '#0b0e14', color: '#e6edf3',
      fontFamily: 'system-ui,sans-serif', padding: 24,
      boxSizing: 'border-box', overflow: 'hidden',
      display: 'flex', gap: 20,
    }}>
      {/* Left rail */}
      <div style={{
        width: 288, flex: 'none', background: '#10151d',
        border: '1px solid rgba(255,255,255,.07)', borderRadius: 16,
        padding: '22px 20px', display: 'flex', flexDirection: 'column', gap: 20,
      }}>
        {/* Brand */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 3 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: '#3fb950', boxShadow: '0 0 9px rgba(63,185,80,.7)' }} />
            <span style={{ fontSize: 16, fontWeight: 800, color: '#f1f5f9' }}>服务概览</span>
            <span style={{
              marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5,
              fontSize: 10, fontWeight: 700, letterSpacing: '.1em', color: '#3fb950',
              fontFamily: '"JetBrains Mono",monospace',
            }}>
              <span style={{ position: 'relative', width: 6, height: 6 }}>
                <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: '#3fb950', animation: 'ccPulse 1.8s ease-out infinite' }} />
                <span style={{ position: 'relative', display: 'block', width: 6, height: 6, borderRadius: '50%', background: '#3fb950' }} />
              </span>
              LIVE
            </span>
          </div>
          <div style={{ fontSize: 11, color: '#5b636f', fontFamily: '"JetBrains Mono",monospace', marginLeft: 17 }}>
            homelab · 自动刷新
          </div>
        </div>

        {/* Health ring */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '6px 0' }}>
          <HealthRing pct={pct} size={150} stroke={12} color={headColor}>
            <div style={{ fontSize: 34, fontWeight: 800, color: headColor, fontFamily: '"JetBrains Mono",monospace', lineHeight: 1 }}>
              {Math.round(pct * 100)}<span style={{ fontSize: 15 }}>%</span>
            </div>
            <div style={{ fontSize: 11, color: '#7e8896', marginTop: 6, fontFamily: '"JetBrains Mono",monospace' }}>
              <span style={{ color: '#cdd6e1', fontWeight: 700 }}>{counts.running ?? 0}</span> / {total} 在线
            </div>
            <div style={{ fontSize: 10.5, color: headColor, marginTop: 2, fontWeight: 600 }}>
              {problem > 0 ? '需要关注' : (counts.running ?? 0) === total ? '全部正常' : '部分未运行'}
            </div>
          </HealthRing>
        </div>

        {/* Status counts */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {[
            ['running', counts.running ?? 0],
            ['stopped', (counts.stopped ?? 0) + (counts.paused ?? 0)],
            ['error', counts.error ?? 0],
          ].map(([k, n]) => (
            <div key={k as string} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <StatusDot status={k as string} size={8} pulse={false} />
              <span style={{ fontSize: 12.5, color: '#aab4c2', flex: 1 }}>{CC_STATUS[k as string]?.label}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: CC_STATUS[k as string]?.color, fontFamily: '"JetBrains Mono",monospace' }}>{n as number}</span>
            </div>
          ))}
        </div>

        <div style={{ height: 1, background: 'rgba(255,255,255,.07)' }} />

        {/* Events */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: '#525a66', fontWeight: 700, marginBottom: 12 }}>
            最近事件
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 13, overflow: 'auto', flex: 1, minHeight: 0, paddingRight: 4 }}>
            {events.length === 0 && (
              <div style={{ fontSize: 12, color: '#525a66', fontStyle: 'italic' }}>暂无事件</div>
            )}
            {events.map(e => (
              <div key={e.id} style={{ display: 'flex', gap: 10, animation: 'ccFade .3s ease' }}>
                <div style={{
                  width: 7, height: 7, borderRadius: '50%', background: e.color,
                  marginTop: 5, flex: 'none', boxShadow: `0 0 7px ${e.color}66`,
                }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: '#cdd6e1', lineHeight: 1.4 }}>{e.message}</div>
                  <div style={{ fontSize: 10.5, color: '#525a66', marginTop: 2, fontFamily: '"JetBrains Mono",monospace' }}>{fmtAgo(e.createdAt)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Probe all button */}
        <button
          onClick={handleProbeAll}
          style={{
            padding: '10px', borderRadius: 9,
            border: '1px solid rgba(255,255,255,.12)',
            background: 'rgba(255,255,255,.03)', color: '#cdd6e1',
            fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          ◎ 探测全部服务
        </button>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 22, overflow: 'auto' }}>
        {infra.length > 0 && (
          <C_Section group="infra" items={infra} onAction={onAction} onLogs={handleOpenLogs} onToast={toast.push} />
        )}
        {app.length > 0 && (
          <C_Section group="app" items={app} onAction={onAction} onLogs={handleOpenLogs} onToast={toast.push} />
        )}
        {services.length === 0 && (
          <div style={{ color: '#525a66', fontSize: 14, fontStyle: 'italic', padding: '40px 0', textAlign: 'center' }}>
            正在加载服务…
          </div>
        )}
      </div>

      <LogDrawer
        svc={logSvc}
        lines={logLines}
        logLabel={logEntry?.label}
        logFile={logEntry?.file}
        onClose={() => { setLogSvc(null); setLogEntry(undefined); }}
      />
      <ToastStack items={toast.items} />
    </div>
  );
}
