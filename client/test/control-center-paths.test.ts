import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONTROL_CENTER_BASE_PATH,
  apiPath,
  stripControlCenterBase,
} from '../src/control-center-paths.js';

test('uses the control-center public base path', () => {
  assert.equal(CONTROL_CENTER_BASE_PATH, '/control-center/');
});

test('builds browser API URLs beneath the public base path', () => {
  assert.equal(apiPath('/services'), '/control-center/api/services');
  assert.equal(apiPath('network/ping'), '/control-center/api/network/ping');
});

test('rewrites prefixed API requests for the existing Fastify routes', () => {
  assert.equal(
    stripControlCenterBase('/control-center/api/services?refresh=1'),
    '/api/services?refresh=1',
  );
});
