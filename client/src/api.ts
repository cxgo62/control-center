export type ClashStatus =
  | {
      available: true;
      mixedPort: number;
      mode: string;
      tunEnabled: boolean;
      tunStack: string;
    }
  | {
      available: false;
      error: { code: 'CLASH_CONFIG_UNAVAILABLE'; message: string };
    };

export type KiwiVmSeverity = 'normal' | 'notice' | 'warning' | 'critical';

export interface KiwiVmTrafficSuccess {
  configured: true;
  hostname: string;
  location: string;
  usedBytes: number;
  totalBytes: number;
  remainingBytes: number;
  usagePercent: number;
  monthlyDataMultiplier: number;
  calculationMethod: 'used-times-multiplier';
  nextResetAt: number;
  suspended: boolean;
  policyViolation: boolean;
  severity: KiwiVmSeverity;
  fetchedAt: number;
  cached: boolean;
}

export type KiwiVmTrafficResponse =
  | KiwiVmTrafficSuccess
  | { configured: false; reason: 'credentials_missing' }
  | {
      configured: true;
      error: {
        code:
          | 'KIWIVM_TIMEOUT'
          | 'KIWIVM_NETWORK_ERROR'
          | 'KIWIVM_UPSTREAM_HTTP'
          | 'KIWIVM_INVALID_JSON'
          | 'KIWIVM_API_ERROR'
          | 'KIWIVM_INVALID_DATA';
        message: string;
      };
    };

export const api = {
  getServices: () => fetch('/api/services').then(r => r.json()),
  getEvents: () => fetch('/api/events').then(r => r.json()),
  serviceAction: (id: string, action: string) =>
    fetch(`/api/services/${id}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    }).then(r => r.json()),
  getServiceLogs: (id: string, file?: string) => {
    const q = new URLSearchParams({ lines: '40' });
    if (file) q.set('file', file);
    return fetch(`/api/services/${id}/logs?${q}`).then(r => r.json());
  },
  getNetworkData: (range: string) =>
    fetch(`/api/network/data?range=${range}`).then(r => r.json()),
  probeNetwork: () =>
    fetch('/api/network/probe', { method: 'POST' }).then(r => r.json()),
  pingNetwork: () =>
    fetch('/api/network/ping').then(r => r.json()) as Promise<Record<string, Record<string, { up: boolean; latencyMs: number; probedAt: number }>>>,
  getNetworkProxy: () =>
    fetch('/api/network/proxy').then(r => r.json()),
  setNetworkProxy: (proxyUrl: string) =>
    fetch('/api/network/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proxyUrl }),
    }).then(r => r.json()),
  getClashStatus: () =>
    fetch('/api/network/clash').then(r => r.json()) as Promise<ClashStatus>,
  getKiwiVmTraffic: () =>
    fetch('/api/network/kiwivm-traffic').then(r => r.json()) as Promise<KiwiVmTrafficResponse>,
};
