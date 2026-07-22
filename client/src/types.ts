export type ServiceStatus = 'running' | 'stopped' | 'error' | 'restarting' | 'starting' | 'stopping';
export type ServiceGroup = 'infra' | 'app';

export interface ServiceInfo {
  id: string;
  name: string;
  group: ServiceGroup;
  tech: string;
  status: ServiceStatus;
  latencyMs: number;
  port: string;
  addr: string;
  url?: string;
  startedAt?: number;
  lastCheck: number;
  hist: number[];        // 28-point latency history
  statusHist: string[];  // 40-bucket: 'up'|'down'|'stopped'
  logs?: Array<{
    label: string;
    file: string;
    glyph?: string; // button icon, default '▤'
    tone?: string;  // 'mute' | 'warn' | 'danger' | 'blue' | 'go', default 'mute'
  }>;
}

export interface Event {
  id: number;
  serviceId?: string;
  color: string;
  message: string;
  createdAt: number;
}

export interface LogLine {
  level: 'info' | 'warn' | 'error';
  text: string;
}

export interface NetBucket {
  up: boolean;
  latencyMs: number;
  hasData: boolean;
  startAt: number;
  endAt: number;
}

export interface NetDest {
  id: string;
  name: string;
  host: string;
  group: string;
  up: boolean;
  latencyMs: number;
  probedAt: number | null;
  avail: number;
  buckets: NetBucket[];
}

export interface NetworkData {
  direct: NetDest[];
  proxy: NetDest[];
  lineDomestic: number[];
  lineInternational: number[];
  probedAt: number;
}
