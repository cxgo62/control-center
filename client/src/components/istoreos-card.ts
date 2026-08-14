import type { IStoreOSServiceInfo, ServiceInfo } from '../types.js';
import { SERVICE_CARD_HEIGHT } from './service-card-layout.js';

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
