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
    fetch('/api/network/ping').then(r => r.json()) as Promise<Record<string, Record<string, { up: boolean; latencyMs: number }>>>,
  getNetworkProxy: () =>
    fetch('/api/network/proxy').then(r => r.json()),
  setNetworkProxy: (proxyUrl: string) =>
    fetch('/api/network/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proxyUrl }),
    }).then(r => r.json()),
  getFlClash: () => fetch('/api/flclash').then(r => r.json()),
};
