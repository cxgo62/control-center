import React from 'react';
import type { ServiceInfo, ServiceStatus, Event, LogLine } from './types.js';
import { api } from './api.js';
import { ServicesPage } from './components/ServicesPage.js';
import { NetworkPage } from './components/NetworkPage.js';

type Tab = 'services' | 'network';

// ---- TopNav ----

interface NavTabProps {
  label: string;
  icon: string;
  active: boolean;
  onClick: () => void;
}

function NavTab({ label, icon, active, onClick }: NavTabProps) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '8px 16px', borderRadius: 9, border: 'none', cursor: 'pointer',
        fontFamily: 'inherit', fontSize: 13.5, fontWeight: 600, transition: 'all .14s',
        background: active ? 'rgba(255,255,255,.07)' : 'transparent',
        color: active ? '#f1f5f9' : '#8b98a9',
      }}
    >
      <span style={{ fontSize: 14, opacity: active ? 1 : 0.7 }}>{icon}</span>{label}
    </button>
  );
}

interface TopNavProps {
  tab: Tab;
  setTab: (t: Tab) => void;
  onlineN: number;
  totalN: number;
}

function TopNav({ tab, setTab, onlineN, totalN }: TopNavProps) {
  const [clock, setClock] = React.useState('');
  React.useEffect(() => {
    const f = () => setClock(new Date().toLocaleTimeString('zh-CN', { hour12: false }));
    f();
    const t = setInterval(f, 1000);
    return () => clearInterval(t);
  }, []);

  const allOk = onlineN === totalN && totalN > 0;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 20, height: 60, flex: 'none',
      padding: '0 24px', background: '#0c1016',
      borderBottom: '1px solid rgba(255,255,255,.08)', position: 'relative', zIndex: 20,
    }}>
      {/* Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
        <div style={{
          width: 30, height: 30, borderRadius: 9,
          background: 'linear-gradient(150deg,#1c2738,#11161e)',
          border: '1px solid rgba(255,255,255,.12)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ width: 9, height: 9, borderRadius: 3, background: '#3fb950', boxShadow: '0 0 9px rgba(63,185,80,.8)' }} />
        </div>
        <div>
          <div style={{ fontSize: 14.5, fontWeight: 800, color: '#f1f5f9', lineHeight: 1 }}>服务控制中心</div>
          <div style={{ fontSize: 9.5, color: '#525a66', fontFamily: '"JetBrains Mono",monospace', letterSpacing: '.12em', marginTop: 2 }}>CONTROL CENTER</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginLeft: 14 }}>
        <NavTab label="服务" icon="▦" active={tab === 'services'} onClick={() => setTab('services')} />
        <NavTab label="网络" icon="◈" active={tab === 'network'} onClick={() => setTab('network')} />
      </div>

      {/* Right status */}
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: '#aab4c2', fontFamily: '"JetBrains Mono",monospace' }}>
          <span style={{ position: 'relative', width: 7, height: 7 }}>
            <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: allOk ? '#3fb950' : '#d9a531', animation: 'ccPulse 1.8s ease-out infinite' }} />
            <span style={{ position: 'relative', display: 'block', width: 7, height: 7, borderRadius: '50%', background: allOk ? '#3fb950' : '#d9a531' }} />
          </span>
          在线 <span style={{ color: '#e6edf3', fontWeight: 700 }}>{onlineN}/{totalN}</span>
        </div>
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: '.12em', color: '#3fb950',
          fontFamily: '"JetBrains Mono",monospace', padding: '3px 8px', borderRadius: 6,
          border: '1px solid rgba(63,185,80,.3)', background: 'rgba(63,185,80,.08)',
        }}>LIVE</span>
        <span style={{ fontSize: 12.5, color: '#6b7482', fontFamily: '"JetBrains Mono",monospace', minWidth: 64, textAlign: 'right' }}>
          {clock}
        </span>
      </div>
    </div>
  );
}

// ---- App ----

// 每个操作对应的：本地过渡态 + 期望的终态列表
const ACTION_TRANSITION: Record<string, {
  localStatus: ServiceStatus;
  terminalStates: ServiceStatus[];
}> = {
  restart: { localStatus: 'restarting', terminalStates: ['running', 'error'] },
  start:   { localStatus: 'starting',   terminalStates: ['running', 'error'] },
  stop:    { localStatus: 'stopping',   terminalStates: ['stopped', 'error'] },
};

// 每个正在等待终态的服务
interface PendingEntry {
  localStatus: ServiceStatus;
  terminalStates: ServiceStatus[];
  startedAt: number;
}

const PENDING_TIMEOUT_MS = 30_000; // 30s 后无论如何退出过渡态

export function App() {
  const [tab, setTab] = React.useState<Tab>(() =>
    window.location.hash === '#network' ? 'network' : 'services'
  );

  const handleSetTab = (t: Tab) => {
    setTab(t);
    window.location.hash = t;
  };
  const [services, setServices] = React.useState<ServiceInfo[]>([]);
  const [events, setEvents] = React.useState<Event[]>([]);
  // id → 正在等待终态的条目
  const [pending, setPending] = React.useState<Map<string, PendingEntry>>(new Map());

  // 从 API 拿到新数据后，检查哪些 pending 服务已经到达终态
  const applyFreshData = React.useCallback((svcs: ServiceInfo[], evts: Event[]) => {
    setEvents(evts);
    setPending(prev => {
      if (prev.size === 0) {
        setServices(svcs);
        return prev;
      }
      const now = Date.now();
      const next = new Map(prev);
      for (const [id, entry] of prev) {
        const fresh = svcs.find(s => s.id === id);
        const timedOut = now - entry.startedAt > PENDING_TIMEOUT_MS;
        if (!fresh || timedOut || entry.terminalStates.includes(fresh.status)) {
          next.delete(id);
        }
      }
      // 把还在过渡态的服务的 status 替换成本地 localStatus，其余用真实数据
      setServices(svcs.map(s => {
        const p = next.get(s.id);
        return p ? { ...s, status: p.localStatus } : s;
      }));
      return next;
    });
  }, []);

  const fetchAll = React.useCallback(async () => {
    try {
      const [svcs, evts] = await Promise.all([api.getServices(), api.getEvents()]);
      applyFreshData(svcs, evts);
    } catch { /* ignore */ }
  }, [applyFreshData]);

  // 常规轮询：10s
  React.useEffect(() => {
    fetchAll();
    const t = setInterval(fetchAll, 10_000);
    return () => clearInterval(t);
  }, [fetchAll]);

  // 快速轮询：有 pending 时每 2s 探一次，直到全部清空
  React.useEffect(() => {
    if (pending.size === 0) return;
    const t = setInterval(fetchAll, 2_000);
    return () => clearInterval(t);
  }, [pending.size, fetchAll]);

  const handleAction = async (id: string, action: string) => {
    const transition = ACTION_TRANSITION[action];

    if (transition) {
      // 立即在 UI 上显示过渡态
      setServices(prev => prev.map(s =>
        s.id === id ? { ...s, status: transition.localStatus } : s
      ));
      setPending(prev => new Map(prev).set(id, {
        localStatus: transition.localStatus,
        terminalStates: transition.terminalStates,
        startedAt: Date.now(),
      }));
    }

    try {
      await api.serviceAction(id, action);
    } catch { /* ignore */ }

    // probe 操作：直接刷新一次即可
    if (!transition) fetchAll();
  };

  const handleFetchLogs = async (id: string, file?: string): Promise<LogLine[]> => {
    try {
      return await api.getServiceLogs(id, file);
    } catch {
      return [];
    }
  };

  const onlineN = services.filter(s => s.status === 'running').length;

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0b0e14', overflow: 'hidden' }}>
      <TopNav tab={tab} setTab={handleSetTab} onlineN={onlineN} totalN={services.length} />
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <div style={{ position: 'absolute', inset: 0, display: tab === 'services' ? 'block' : 'none' }}>
          <ServicesPage
            services={services}
            events={events}
            onAction={handleAction}
            onFetchLogs={(id, file) => handleFetchLogs(id, file)}
          />
        </div>
        <div style={{ position: 'absolute', inset: 0, display: tab === 'network' ? 'block' : 'none' }}>
          {tab === 'network' && <NetworkPage />}
        </div>
      </div>
    </div>
  );
}
