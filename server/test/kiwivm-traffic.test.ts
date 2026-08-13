import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createKiwiVmTrafficClient,
  createKiwiVmTrafficHandler,
  KiwiVmError,
  normalizeKiwiVmResponse,
  parseKiwiVmCredentials,
  severityForUsage,
} from '../src/routes/kiwivm-traffic.js';

const GiB = 1024 ** 3;

function validRaw(overrides: Record<string, unknown> = {}) {
  return {
    error: 0,
    hostname: 'example-host',
    node_location: 'US, California',
    plan_monthly_data: 500 * GiB,
    data_counter: 100 * GiB,
    monthly_data_multiplier: 2,
    data_next_reset: 1_788_364_800,
    suspended: 0,
    policy_violation: false,
    ...overrides,
  };
}

test('KiwiVM credentials parse without exposing unrelated values', () => {
  assert.deepEqual(parseKiwiVmCredentials(`
# local only
KIWIVM_VEID=12345
KIWIVM_API_KEY=dummy-secret
`), { veid: '12345', apiKey: 'dummy-secret' });

  assert.equal(parseKiwiVmCredentials('KIWIVM_VEID=replace_me\nKIWIVM_API_KEY=replace_me\n'), null);
  assert.equal(parseKiwiVmCredentials('KIWIVM_VEID=12345\n'), null);
  assert.equal(parseKiwiVmCredentials('not-an-env-line\nKIWIVM_VEID=12345\nKIWIVM_API_KEY=x\n'), null);
});

test('KiwiVM normalizes candidate-A traffic calculation and seconds timestamps', () => {
  assert.deepEqual(normalizeKiwiVmResponse(validRaw(), 1_000), {
    configured: true,
    hostname: 'example-host',
    location: 'US, California',
    usedBytes: 200 * GiB,
    totalBytes: 500 * GiB,
    remainingBytes: 300 * GiB,
    usagePercent: 40,
    monthlyDataMultiplier: 2,
    calculationMethod: 'used-times-multiplier',
    nextResetAt: 1_788_364_800_000,
    suspended: false,
    policyViolation: false,
    severity: 'normal',
    fetchedAt: 1_000,
    cached: false,
  });
});

test('KiwiVM supports multiplier one, boolean flags, and clamps remaining traffic', () => {
  const result = normalizeKiwiVmResponse(validRaw({
    plan_monthly_data: 100 * GiB,
    data_counter: 120 * GiB,
    monthly_data_multiplier: 1,
    suspended: true,
    policy_violation: 1,
  }), 2_000);

  assert.equal(result.usedBytes, 120 * GiB);
  assert.equal(result.remainingBytes, 0);
  assert.equal(result.usagePercent, 120);
  assert.equal(result.severity, 'critical');
  assert.equal(result.suspended, true);
  assert.equal(result.policyViolation, true);
});

test('KiwiVM severity follows the configured boundaries', () => {
  assert.equal(severityForUsage(0), 'normal');
  assert.equal(severityForUsage(69.999), 'normal');
  assert.equal(severityForUsage(70), 'notice');
  assert.equal(severityForUsage(84.999), 'notice');
  assert.equal(severityForUsage(85), 'warning');
  assert.equal(severityForUsage(94.999), 'warning');
  assert.equal(severityForUsage(95), 'critical');
});

test('KiwiVM rejects malformed and unsafe response values', () => {
  const invalidOverrides = [
    { hostname: '' },
    { node_location: 123 },
    { plan_monthly_data: 0 },
    { plan_monthly_data: '500' },
    { data_counter: -1 },
    { data_counter: '100' },
    { monthly_data_multiplier: 0 },
    { monthly_data_multiplier: '2' },
    { data_next_reset: 0 },
    { data_next_reset: '1788364800' },
    { suspended: 2 },
    { policy_violation: 'false' },
  ];

  for (const override of invalidOverrides) {
    assert.throws(
      () => normalizeKiwiVmResponse(validRaw(override), 1_000),
      (error: unknown) => error instanceof KiwiVmError && error.code === 'KIWIVM_INVALID_DATA',
    );
  }

  const missing = validRaw();
  delete (missing as Record<string, unknown>).data_counter;
  assert.throws(
    () => normalizeKiwiVmResponse(missing, 1_000),
    (error: unknown) => error instanceof KiwiVmError && error.code === 'KIWIVM_INVALID_DATA',
  );
});

test('KiwiVM API failures expose only a stable sanitized error', () => {
  const secret = 'dummy-api-key-never-leak';
  assert.throws(
    () => normalizeKiwiVmResponse({
      error: 1,
      message: `bad credential ${secret}`,
    }, 1_000),
    (error: unknown) => {
      assert.ok(error instanceof KiwiVmError);
      assert.equal(error.code, 'KIWIVM_API_ERROR');
      assert.equal(error.statusCode, 502);
      assert.equal(error.message.includes(secret), false);
      return true;
    },
  );
});

test('KiwiVM client posts credentials in a form body without a query string', async () => {
  let capturedUrl = '';
  let capturedInit: RequestInit | undefined;
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    capturedUrl = String(url);
    capturedInit = init;
    return new Response(JSON.stringify(validRaw()), { status: 200 });
  }) as typeof fetch;
  const client = createKiwiVmTrafficClient({ fetcher, now: () => 10_000 });

  const result = await client.get({ veid: 'dummy-veid', apiKey: 'dummy-secret' });

  assert.equal(capturedUrl, 'https://api.64clouds.com/v1/getServiceInfo');
  assert.equal(capturedInit?.method, 'POST');
  assert.equal(new Headers(capturedInit?.headers).get('content-type'), 'application/x-www-form-urlencoded');
  assert.equal(String(capturedInit?.body), 'veid=dummy-veid&api_key=dummy-secret');
  assert.equal(result.fetchedAt, 10_000);
  assert.equal(result.cached, false);
});

test('KiwiVM client maps upstream, JSON, timeout, and network failures safely', async () => {
  const cases: Array<{
    fetcher: typeof fetch;
    code: string;
    statusCode: number;
  }> = [
    {
      fetcher: (async () => new Response('unavailable', { status: 503 })) as typeof fetch,
      code: 'KIWIVM_UPSTREAM_HTTP',
      statusCode: 502,
    },
    {
      fetcher: (async () => new Response('not-json', { status: 200 })) as typeof fetch,
      code: 'KIWIVM_INVALID_JSON',
      statusCode: 502,
    },
    {
      fetcher: (async () => {
        const error = new Error('dummy-secret');
        error.name = 'AbortError';
        throw error;
      }) as typeof fetch,
      code: 'KIWIVM_TIMEOUT',
      statusCode: 504,
    },
    {
      fetcher: (async () => { throw new Error('connection refused dummy-secret'); }) as typeof fetch,
      code: 'KIWIVM_NETWORK_ERROR',
      statusCode: 502,
    },
  ];

  for (const item of cases) {
    const client = createKiwiVmTrafficClient({ fetcher: item.fetcher });
    await assert.rejects(
      client.get({ veid: 'dummy-veid', apiKey: 'dummy-secret' }),
      (error: unknown) => {
        assert.ok(error instanceof KiwiVmError);
        assert.equal(error.code, item.code);
        assert.equal(error.statusCode, item.statusCode);
        assert.equal(error.message.includes('dummy-secret'), false);
        assert.equal(error.message.includes('dummy-veid'), false);
        return true;
      },
    );
  }
});

test('KiwiVM client caches successes for five minutes', async () => {
  let now = 1_000;
  let calls = 0;
  const fetcher = (async () => {
    calls += 1;
    return new Response(JSON.stringify(validRaw()), { status: 200 });
  }) as typeof fetch;
  const client = createKiwiVmTrafficClient({ fetcher, now: () => now });
  const credentials = { veid: 'dummy-veid', apiKey: 'dummy-secret' };

  const fresh = await client.get(credentials);
  now += 299_999;
  const cached = await client.get(credentials);
  now += 2;
  const refreshed = await client.get(credentials);

  assert.equal(calls, 2);
  assert.equal(fresh.cached, false);
  assert.equal(cached.cached, true);
  assert.equal(cached.fetchedAt, fresh.fetchedAt);
  assert.equal(refreshed.cached, false);
});

test('KiwiVM client deduplicates concurrent cold-cache requests', async () => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const fetcher = (async () => {
    calls += 1;
    await gate;
    return new Response(JSON.stringify(validRaw()), { status: 200 });
  }) as typeof fetch;
  const client = createKiwiVmTrafficClient({ fetcher, now: () => 1_000 });
  const credentials = { veid: 'dummy-veid', apiKey: 'dummy-secret' };

  const first = client.get(credentials);
  const second = client.get(credentials);
  release();
  const results = await Promise.all([first, second]);

  assert.equal(calls, 1);
  assert.deepEqual(results.map(result => result.cached), [false, false]);
});

test('KiwiVM client does not cache failed requests', async () => {
  let calls = 0;
  const fetcher = (async () => {
    calls += 1;
    if (calls === 1) return new Response('failed', { status: 500 });
    return new Response(JSON.stringify(validRaw()), { status: 200 });
  }) as typeof fetch;
  const client = createKiwiVmTrafficClient({ fetcher });
  const credentials = { veid: 'dummy-veid', apiKey: 'dummy-secret' };

  await assert.rejects(client.get(credentials), KiwiVmError);
  const result = await client.get(credentials);

  assert.equal(calls, 2);
  assert.equal(result.cached, false);
});

test('KiwiVM route returns an unconfigured state for missing or placeholder credentials', async () => {
  const missing = createKiwiVmTrafficHandler({
    readCredentialsFile: () => { throw new Error('missing'); },
    client: { get: async () => { throw new Error('must not fetch'); } },
    logWarning: () => { throw new Error('must not log setup absence'); },
  });
  const placeholder = createKiwiVmTrafficHandler({
    readCredentialsFile: () => 'KIWIVM_VEID=replace_me\nKIWIVM_API_KEY=replace_me\n',
    client: { get: async () => { throw new Error('must not fetch'); } },
    logWarning: () => { throw new Error('must not log setup absence'); },
  });

  assert.deepEqual(await missing(), {
    statusCode: 200,
    body: { configured: false, reason: 'credentials_missing' },
  });
  assert.deepEqual(await placeholder(), {
    statusCode: 200,
    body: { configured: false, reason: 'credentials_missing' },
  });
});

test('KiwiVM route returns normalized client success', async () => {
  const success = normalizeKiwiVmResponse(validRaw(), 1_000);
  const handler = createKiwiVmTrafficHandler({
    readCredentialsFile: () => 'KIWIVM_VEID=dummy-veid\nKIWIVM_API_KEY=dummy-secret\n',
    client: { get: async () => success },
    logWarning: () => { throw new Error('must not log success'); },
  });

  assert.deepEqual(await handler(), { statusCode: 200, body: success });
});

test('KiwiVM route maps safe known errors and logs only the stable code', async () => {
  const logEntries: unknown[] = [];
  const handler = createKiwiVmTrafficHandler({
    readCredentialsFile: () => 'KIWIVM_VEID=dummy-veid\nKIWIVM_API_KEY=dummy-secret\n',
    client: {
      get: async () => {
        throw new KiwiVmError('KIWIVM_TIMEOUT', 'KiwiVM 查询超时', 504);
      },
    },
    logWarning: entry => { logEntries.push(entry); },
  });

  assert.deepEqual(await handler(), {
    statusCode: 504,
    body: {
      configured: true,
      error: { code: 'KIWIVM_TIMEOUT', message: 'KiwiVM 查询超时' },
    },
  });
  assert.deepEqual(logEntries, [{ code: 'KIWIVM_TIMEOUT' }]);
});

test('KiwiVM route sanitizes unexpected errors and logs no secret material', async () => {
  const logEntries: unknown[] = [];
  const handler = createKiwiVmTrafficHandler({
    readCredentialsFile: () => 'KIWIVM_VEID=dummy-veid\nKIWIVM_API_KEY=dummy-secret\n',
    client: { get: async () => { throw new Error('dummy-veid dummy-secret'); } },
    logWarning: entry => { logEntries.push(entry); },
  });

  const result = await handler();
  assert.deepEqual(result, {
    statusCode: 502,
    body: {
      configured: true,
      error: { code: 'KIWIVM_NETWORK_ERROR', message: '无法连接 KiwiVM 服务' },
    },
  });
  assert.equal(JSON.stringify({ result, logEntries }).includes('dummy-secret'), false);
  assert.equal(JSON.stringify({ result, logEntries }).includes('dummy-veid'), false);
  assert.deepEqual(logEntries, [{ code: 'KIWIVM_NETWORK_ERROR' }]);
});
