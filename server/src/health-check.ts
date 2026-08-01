import { fetch } from 'undici';
import type { JsonExpectation, ServiceHealthConfig } from './config.js';

export interface HttpProbeResult {
  status: 'running' | 'stopped' | 'error';
  latencyMs: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function matchesJsonExpectation(actual: unknown, expected: JsonExpectation): boolean {
  if (!isRecord(expected)) return Object.is(actual, expected);
  if (!isRecord(actual)) return false;
  return Object.entries(expected).every(([key, value]) =>
    Object.prototype.hasOwnProperty.call(actual, key) && matchesJsonExpectation(actual[key], value)
  );
}

function isConnectionRefused(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const cause = 'cause' in error ? error.cause : undefined;
  return error.message.includes('ECONNREFUSED')
    || (isRecord(cause) && cause.code === 'ECONNREFUSED');
}

export async function probeHttpHealth(url: string, health?: ServiceHealthConfig): Promise<HttpProbeResult> {
  const startedAt = Date.now();
  const elapsedMs = () => Math.max(1, Date.now() - startedAt);
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(health?.timeoutMs ?? 5_000) });
    if (health?.expect?.httpStatus !== undefined && response.status !== health.expect.httpStatus) {
      return { status: 'error', latencyMs: elapsedMs() };
    }
    if (health?.expect?.json !== undefined) {
      const body: unknown = await response.json();
      if (!matchesJsonExpectation(body, health.expect.json)) {
        return { status: 'error', latencyMs: elapsedMs() };
      }
    }
    return { status: 'running', latencyMs: elapsedMs() };
  } catch (error: unknown) {
    return {
      status: isConnectionRefused(error) ? 'stopped' : 'error',
      latencyMs: elapsedMs(),
    };
  }
}
