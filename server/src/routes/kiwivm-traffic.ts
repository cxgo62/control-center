export type KiwiVmSeverity = 'normal' | 'notice' | 'warning' | 'critical';

export type KiwiVmErrorCode =
  | 'KIWIVM_TIMEOUT'
  | 'KIWIVM_NETWORK_ERROR'
  | 'KIWIVM_UPSTREAM_HTTP'
  | 'KIWIVM_INVALID_JSON'
  | 'KIWIVM_API_ERROR'
  | 'KIWIVM_INVALID_DATA';

export interface KiwiVmCredentials {
  veid: string;
  apiKey: string;
}

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

export class KiwiVmError extends Error {
  constructor(
    public readonly code: KiwiVmErrorCode,
    message: string,
    public readonly statusCode: 502 | 504,
  ) {
    super(message);
    this.name = 'KiwiVmError';
  }
}

const invalidData = () => new KiwiVmError(
  'KIWIVM_INVALID_DATA',
  'KiwiVM 返回的数据格式无效',
  502,
);

export function parseKiwiVmCredentials(content: string): KiwiVmCredentials | null {
  const values = new Map<string, string>();

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const separator = line.indexOf('=');
    if (separator <= 0) return null;

    values.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }

  const veid = values.get('KIWIVM_VEID') ?? '';
  const apiKey = values.get('KIWIVM_API_KEY') ?? '';
  if (
    !veid
    || !apiKey
    || veid.toLowerCase() === 'replace_me'
    || apiKey.toLowerCase() === 'replace_me'
  ) {
    return null;
  }

  return { veid, apiKey };
}

export function severityForUsage(percent: number): KiwiVmSeverity {
  if (percent >= 95) return 'critical';
  if (percent >= 85) return 'warning';
  if (percent >= 70) return 'notice';
  return 'normal';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(raw: Record<string, unknown>, key: string): string {
  const value = raw[key];
  if (typeof value !== 'string' || value.trim().length === 0) throw invalidData();
  return value.trim();
}

function requiredNumber(
  raw: Record<string, unknown>,
  key: string,
  predicate: (value: number) => boolean,
): number {
  const value = raw[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || !predicate(value)) {
    throw invalidData();
  }
  return value;
}

function requiredBooleanFlag(raw: Record<string, unknown>, key: string): boolean {
  const value = raw[key];
  if (typeof value === 'boolean') return value;
  if (value === 0) return false;
  if (value === 1) return true;
  throw invalidData();
}

export function normalizeKiwiVmResponse(rawValue: unknown, fetchedAt: number): KiwiVmTrafficSuccess {
  if (!isRecord(rawValue)) throw invalidData();

  const error = requiredNumber(rawValue, 'error', () => true);
  if (error !== 0) {
    throw new KiwiVmError('KIWIVM_API_ERROR', 'KiwiVM 拒绝了查询请求', 502);
  }

  const hostname = requiredString(rawValue, 'hostname');
  const location = requiredString(rawValue, 'node_location');
  const totalBytes = requiredNumber(rawValue, 'plan_monthly_data', value => value > 0);
  const counterBytes = requiredNumber(rawValue, 'data_counter', value => value >= 0);
  const monthlyDataMultiplier = requiredNumber(
    rawValue,
    'monthly_data_multiplier',
    value => value > 0,
  );
  const nextResetSeconds = requiredNumber(rawValue, 'data_next_reset', value => value > 0);
  const suspended = requiredBooleanFlag(rawValue, 'suspended');
  const policyViolation = requiredBooleanFlag(rawValue, 'policy_violation');

  const usedBytes = counterBytes * monthlyDataMultiplier;
  const usagePercent = (usedBytes / totalBytes) * 100;
  const nextResetAt = nextResetSeconds * 1000;
  if (
    ![usedBytes, usagePercent, nextResetAt].every(Number.isFinite)
    || Number.isNaN(new Date(nextResetAt).getTime())
  ) {
    throw invalidData();
  }

  return {
    configured: true,
    hostname,
    location,
    usedBytes,
    totalBytes,
    remainingBytes: Math.max(totalBytes - usedBytes, 0),
    usagePercent,
    monthlyDataMultiplier,
    calculationMethod: 'used-times-multiplier',
    nextResetAt,
    suspended,
    policyViolation,
    severity: severityForUsage(usagePercent),
    fetchedAt,
    cached: false,
  };
}

interface KiwiVmTrafficClientOptions {
  fetcher?: typeof fetch;
  now?: () => number;
  ttlMs?: number;
  timeoutMs?: number;
}

export interface KiwiVmTrafficClient {
  get(credentials: KiwiVmCredentials): Promise<KiwiVmTrafficSuccess>;
}

export type KiwiVmTrafficResponse =
  | KiwiVmTrafficSuccess
  | { configured: false; reason: 'credentials_missing' }
  | {
      configured: true;
      error: { code: KiwiVmErrorCode; message: string };
    };

const KIWIVM_ENDPOINT = 'https://api.64clouds.com/v1/getServiceInfo';

function credentialsKey(credentials: KiwiVmCredentials): string {
  return `${credentials.veid}\u0000${credentials.apiKey}`;
}

export function createKiwiVmTrafficClient(
  options: KiwiVmTrafficClientOptions = {},
): KiwiVmTrafficClient {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? 5 * 60 * 1000;
  const timeoutMs = options.timeoutMs ?? 20_000;

  let cache: { key: string; expiresAt: number; value: KiwiVmTrafficSuccess } | null = null;
  let inFlight: { key: string; promise: Promise<KiwiVmTrafficSuccess> } | null = null;

  const fetchFresh = async (credentials: KiwiVmCredentials): Promise<KiwiVmTrafficSuccess> => {
    const body = new URLSearchParams({
      veid: credentials.veid,
      api_key: credentials.apiKey,
    });

    try {
      const response = await fetcher(KIWIVM_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        throw new KiwiVmError(
          'KIWIVM_UPSTREAM_HTTP',
          'KiwiVM 服务暂时不可用',
          502,
        );
      }

      const responseText = await response.text();
      let raw: unknown;
      try {
        raw = JSON.parse(responseText);
      } catch {
        throw new KiwiVmError(
          'KIWIVM_INVALID_JSON',
          'KiwiVM 返回了无法解析的数据',
          502,
        );
      }

      return normalizeKiwiVmResponse(raw, now());
    } catch (error) {
      if (error instanceof KiwiVmError) throw error;

      const errorName = isRecord(error) && typeof error.name === 'string' ? error.name : '';
      if (errorName === 'AbortError' || errorName === 'TimeoutError') {
        throw new KiwiVmError('KIWIVM_TIMEOUT', 'KiwiVM 查询超时', 504);
      }
      throw new KiwiVmError('KIWIVM_NETWORK_ERROR', '无法连接 KiwiVM 服务', 502);
    }
  };

  return {
    async get(credentials: KiwiVmCredentials): Promise<KiwiVmTrafficSuccess> {
      const key = credentialsKey(credentials);
      const currentTime = now();
      if (cache && cache.key === key && currentTime < cache.expiresAt) {
        return { ...cache.value, cached: true };
      }
      if (inFlight?.key === key) return inFlight.promise;

      const promise = fetchFresh(credentials).then(value => {
        cache = {
          key,
          expiresAt: value.fetchedAt + ttlMs,
          value,
        };
        return { ...value, cached: false };
      });
      inFlight = { key, promise };

      try {
        return await promise;
      } finally {
        if (inFlight?.promise === promise) inFlight = null;
      }
    },
  };
}

interface KiwiVmTrafficHandlerOptions {
  readCredentialsFile: () => string;
  client: KiwiVmTrafficClient;
  logWarning: (entry: { code: KiwiVmErrorCode }) => void;
}

export function createKiwiVmTrafficHandler(
  options: KiwiVmTrafficHandlerOptions,
): () => Promise<{ statusCode: number; body: KiwiVmTrafficResponse }> {
  return async () => {
    let content: string;
    try {
      content = options.readCredentialsFile();
    } catch {
      return {
        statusCode: 200,
        body: { configured: false, reason: 'credentials_missing' },
      };
    }

    const credentials = parseKiwiVmCredentials(content);
    if (!credentials) {
      return {
        statusCode: 200,
        body: { configured: false, reason: 'credentials_missing' },
      };
    }

    try {
      return { statusCode: 200, body: await options.client.get(credentials) };
    } catch (error) {
      const safeError = error instanceof KiwiVmError
        ? error
        : new KiwiVmError('KIWIVM_NETWORK_ERROR', '无法连接 KiwiVM 服务', 502);
      options.logWarning({ code: safeError.code });
      return {
        statusCode: safeError.statusCode,
        body: {
          configured: true,
          error: { code: safeError.code, message: safeError.message },
        },
      };
    }
  };
}
