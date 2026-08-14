export type ServiceStatus = 'running' | 'stopped' | 'error' | 'restarting' | 'starting' | 'stopping';
export type ServiceGroup = 'infra' | 'app';

export interface ServiceInfoBase {
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

export interface IStoreOSMonitorInfo {
  state: 'checking' | 'healthy' | 'proxy_error' | 'offline';
  status: 'running' | 'error' | 'stopped';
  sshOk: boolean;
  xrayOk: boolean | null;
  proxyOk: boolean | null;
  proxyLatencyMs: number | null;
  checkedAt: number | null;
  latencyMs: number;
}

export interface StandardServiceInfo extends ServiceInfoBase {
  kind?: undefined;
  monitor?: undefined;
}

export interface IStoreOSServiceInfo extends ServiceInfoBase {
  kind: 'istoreos';
  monitor: IStoreOSMonitorInfo;
}

export type ServiceInfo = StandardServiceInfo | IStoreOSServiceInfo;

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

export interface LatencyBucket {
  startAt: number;
  endAt: number;
  latencyMs: number | null;
  hasData: boolean;
}

export interface LatencySeries {
  id: string;
  label: string;
  color: string;
  buckets: LatencyBucket[];
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
  latencySeries: LatencySeries[];
  probedAt: number;
}

export type NetworkRange = '1h' | '6h' | '24h' | '7d';
export type VpsTcpState = 'up' | 'intermittent' | 'down' | 'unknown';
export type VpsTcpProbeState = Exclude<VpsTcpState, 'intermittent'>;
export type VpsLineQualityState = 'good' | 'degraded' | 'poor' | 'collecting' | 'ping-unavailable' | 'unavailable';

export interface VpsLineBucket {
  startAt: number;
  endAt: number;
  hasData: boolean;
  medianLatencyMs: number | null;
  p95LatencyMs: number | null;
  sent: number | null;
  lost: number | null;
  lossPercent: number | null;
  jitterMs: number | null;
  tcpState: VpsTcpState;
}

export interface VpsLineCurrent {
  hasData: boolean;
  medianLatencyMs: number | null;
  p95LatencyMs: number | null;
  jitterMs: number | null;
  tcpState: VpsTcpProbeState;
  icmpUsable: boolean | null;
  probedAt: number | null;
  sent: number | null;
  lost: number | null;
  lossPercent: number | null;
}

export interface VpsLineRangeSummary {
  hasData: boolean;
  sent: number | null;
  lost: number | null;
  lossPercent: number | null;
}

export interface VpsLineQuality {
  state: VpsLineQualityState;
  label: string;
  diagnostic?: 'tcp-failed';
}

interface VpsLineMeasuredResponse {
  displayLabel: '搬瓦工私人线路';
  quality: VpsLineQuality;
  current: VpsLineCurrent;
  rangeSummary: VpsLineRangeSummary;
  buckets: VpsLineBucket[];
}

export interface VpsLineUnconfiguredResponse {
  status: 'unconfigured';
  displayLabel: '搬瓦工私人线路';
  message: '私人节点未配置';
}

export interface VpsLineUnresolvedResponse {
  status: 'unresolved';
  displayLabel: '搬瓦工私人线路';
  message: '无法识别私人节点';
}

export interface VpsLineAccumulatingResponse extends VpsLineMeasuredResponse {
  status: 'accumulating';
}

export interface VpsLineAvailableResponse extends VpsLineMeasuredResponse {
  status: 'available';
}

export interface VpsLineErrorResponse {
  status: 'error';
  displayLabel: '搬瓦工私人线路';
  error: {
    code: 'VPS_LINE_DATA_UNAVAILABLE';
    message: '线路数据暂时不可用';
  };
}

export type VpsLineResponse =
  | VpsLineUnconfiguredResponse
  | VpsLineUnresolvedResponse
  | VpsLineAccumulatingResponse
  | VpsLineAvailableResponse
  | VpsLineErrorResponse;
