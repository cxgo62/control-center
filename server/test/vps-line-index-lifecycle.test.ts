import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const indexSource = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');

test('server lifecycle starts and stops the configured VPS line monitor', () => {
  assert.match(indexSource, /createVpsLineMonitor\s*\(/);
  assert.match(indexSource, /configuredNodeName:\s*VPS_LINE_NODE_NAME/);
  assert.match(indexSource, /configPath:\s*clashVergeConfigPath\(homedir\(\)\)/);
  assert.match(indexSource, /await\s+vpsLineMonitor\.start\(\)/);
  assert.match(indexSource, /vpsLineMonitor\.stop\(\)/);
});

test('server startup and shutdown lifecycle logs use structured stable codes', () => {
  assert.match(indexSource, /code:\s*'CONTROL_CENTER_STARTED'/);
  assert.match(indexSource, /code:\s*'CONTROL_CENTER_START_FAILED'/);
  assert.match(indexSource, /code:\s*'CONTROL_CENTER_SHUTDOWN_STARTED'/);
  assert.match(indexSource, /code:\s*'CONTROL_CENTER_SHUTDOWN_FAILED'/);
});
