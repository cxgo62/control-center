import React from 'react';
import type { IStoreOSServiceInfo, ServiceInfo } from '../types.js';
import { SERVICE_CARD_HEIGHT } from './service-card-layout.js';
import { ActionBtn, StatusBar, StatusDot, fmtAgo } from './Shared.js';

export const ISTOREOS_CARD_HEIGHT = SERVICE_CARD_HEIGHT;

export function isIStoreOSService(service: ServiceInfo): service is IStoreOSServiceInfo {
  return service.kind === 'istoreos';
}

export function getIStoreOSStatusMeta(service: IStoreOSServiceInfo): {
  label: string;
  color: string;
  status: string;
} {
  switch (service.monitor.state) {
    case 'checking': return { label: '检查中', color: '#5aa0fa', status: 'restarting' };
    case 'healthy': return { label: '健康', color: '#3fb950', status: 'running' };
    case 'proxy_error': return { label: '代理异常', color: '#f15a4a', status: 'error' };
    case 'offline': return { label: '离线', color: '#7d8794', status: 'stopped' };
  }
}

export interface IStoreOSCheckRow {
  label: 'SSH' | 'Xray' | '代理链路';
  ok: boolean | null;
  value?: string;
}

export function getIStoreOSCheckRows(service: IStoreOSServiceInfo): IStoreOSCheckRow[] {
  const { monitor } = service;
  return [
    { label: 'SSH', ok: monitor.sshOk },
    { label: 'Xray', ok: monitor.xrayOk },
    {
      label: '代理链路',
      ok: monitor.proxyOk,
      value: monitor.proxyOk && monitor.proxyLatencyMs !== null ? `${monitor.proxyLatencyMs}ms` : undefined,
    },
  ];
}

export function getIStoreOSActionKeys(): ['probe', 'open'] {
  return ['probe', 'open'];
}

export interface IStoreOSCardProps {
  service: IStoreOSServiceInfo;
  onAction: (id: string, action: string) => void;
  onToast: (message: string) => void;
}

function CheckValue({ ok, value }: { ok: boolean | null; value?: string }) {
  const color = ok === true ? '#3fb950' : ok === false ? '#f15a4a' : '#687382';
  return <span style={{ color, fontWeight: 700 }}>{ok === true ? (value ?? '正常') : ok === false ? '失败' : '—'}</span>;
}

export function IStoreOSCard({ service, onAction, onToast }: IStoreOSCardProps) {
  const meta = getIStoreOSStatusMeta(service);
  const rows = getIStoreOSCheckRows(service);
  const history = service.statusHist.length > 0 ? service.statusHist : Array.from({ length: 40 }, () => 'stopped');
  const [hover, setHover] = React.useState(false);

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: 'linear-gradient(180deg,#141a23,#11161e)',
        border: `1px solid ${hover ? 'rgba(255,255,255,.14)' : 'rgba(255,255,255,.07)'}`,
        borderRadius: 15, padding: '16px 17px 15px',
        height: ISTOREOS_CARD_HEIGHT, boxSizing: 'border-box',
        display: 'flex', flexDirection: 'column', gap: 12,
        position: 'relative', overflow: 'hidden',
        transition: 'border-color .15s, transform .15s, box-shadow .15s',
        transform: hover ? 'translateY(-2px)' : 'none',
        boxShadow: hover ? '0 16px 36px rgba(0,0,0,.4)' : 'none',
      }}
    >
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 2,
        background: `linear-gradient(90deg, ${meta.color}, ${meta.color}00 65%)`,
        opacity: hover ? 0.95 : 0.55,
      }} />

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, height: 54, flex: '0 0 54px' }}>
        <StatusDot status={meta.status} size={10} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15.5, fontWeight: 700, color: '#e9eef4', lineHeight: 1.15 }}>{service.name}</div>
          <div style={{ fontSize: 11, color: '#6b7482', marginTop: 3, fontFamily: '"JetBrains Mono",monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {service.tech}
          </div>
          <div style={{ fontSize: 10, color: '#525a66', marginTop: 3, fontFamily: '"JetBrains Mono",monospace' }}>{service.addr}</div>
        </div>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 7, padding: '3px 9px 3px 8px', borderRadius: 999,
          background: `${meta.color}20`, border: `1px solid ${meta.color}55`, color: meta.color,
          fontSize: 11.5, fontWeight: 600, fontFamily: '"JetBrains Mono",monospace', whiteSpace: 'nowrap',
        }}>{meta.label}</span>
      </div>

      <div style={{ padding: '4px 0 2px', height: 72, boxSizing: 'border-box', flex: '0 0 72px' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 7 }}>
          <span style={{ fontSize: 9.5, letterSpacing: '.12em', textTransform: 'uppercase', color: '#525a66', fontWeight: 700 }}>过去 24 小时</span>
          <span style={{ marginLeft: 'auto', fontSize: 11, fontFamily: '"JetBrains Mono",monospace', color: meta.color, fontWeight: 600 }}>
            {service.monitor.state === 'checking' ? '等待首次探测' : `最近 ${fmtAgo(service.monitor.checkedAt ?? service.lastCheck)}`}
          </span>
        </div>
        <StatusBar hist={history} height={26} />
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5, fontSize: 9.5, color: '#4b5563', fontFamily: '"JetBrains Mono",monospace' }}>
          <span>-24时</span><span>现在</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, padding: '11px 0', height: 50, boxSizing: 'border-box', flex: '0 0 50px', borderTop: '1px solid rgba(255,255,255,.05)' }}>
        {rows.map(row => (
          <div key={row.label} style={{ minWidth: 0, fontFamily: '"JetBrains Mono",monospace' }}>
            <div style={{ fontSize: 9, letterSpacing: '.08em', textTransform: 'uppercase', color: '#525a66', fontWeight: 700, marginBottom: 3 }}>{row.label}</div>
            <div style={{ fontSize: 11.5 }}><CheckValue ok={row.ok} value={row.value} /></div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 'auto', minHeight: 26, display: 'flex', alignItems: 'center', gap: 6 }}>
        <ActionBtn act="probe" primary compact={false} onClick={() => { onAction(service.id, 'probe'); onToast(`已向 ${service.name} 发起健康探测`); }} />
        {service.url && (
          <a href={service.url} target="_blank" rel="noreferrer" style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 7,
            color: '#aab4c2', background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.08)',
            fontSize: 12, fontWeight: 600, lineHeight: 1, textDecoration: 'none',
          }}>↗ 管理界面</a>
        )}
      </div>
    </div>
  );
}
