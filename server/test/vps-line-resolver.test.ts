import assert from 'node:assert/strict';
import test from 'node:test';
import { resolvePrivateNode } from '../src/vps-line/node-resolver.js';

test('resolves an exact proxy name and returns only its safe endpoint fields', () => {
  const result = resolvePrivateNode(`
mixed-port: 7897
proxies:
  - name: public-node
    server: public.example.com
    port: 443
  - name: "Private VPS"
    type: vless
    server: 'new.private.example.com'
    port: 8443
    uuid: very-secret-uuid
    password: very-secret-password
    ws-opts:
      path: /private
      headers:
        Host: hidden.example.com
proxy-groups:
  - name: Private VPS
`, 'Private VPS');

  assert.deepEqual(result, {
    ok: true,
    endpoint: { name: 'Private VPS', host: 'new.private.example.com', port: 8443 },
  });
  assert.deepEqual(Object.keys(result.ok ? result.endpoint : {}).sort(), ['host', 'name', 'port']);
  assert.equal(JSON.stringify(result).includes('very-secret'), false);
  assert.equal(JSON.stringify(result).includes('/private'), false);
});

test('accepts address and port changes without changing the configured identity', () => {
  const first = resolvePrivateNode('proxies:\n  - name: stable-name\n    server: 192.0.2.10\n    port: 1000\n', 'stable-name');
  const second = resolvePrivateNode('proxies:\n  - name: stable-name\n    server: 192.0.2.11\n    port: 2000\n', 'stable-name');

  assert.deepEqual(first, { ok: true, endpoint: { name: 'stable-name', host: '192.0.2.10', port: 1000 } });
  assert.deepEqual(second, { ok: true, endpoint: { name: 'stable-name', host: '192.0.2.11', port: 2000 } });
});

test('accepts safe DNS names and IPv4 literals as proxy hosts', () => {
  for (const host of ['node-1.private.example.com', 'localhost', '192.0.2.25']) {
    assert.deepEqual(resolvePrivateNode(`proxies:\n  - name: target\n    server: ${host}\n    port: 443\n`, 'target'), {
      ok: true,
      endpoint: { name: 'target', host, port: 443 },
    });
  }
});

test('rejects unsafe or unsupported proxy host forms', () => {
  const invalidHosts = [
    '-f',
    'https://private.example.com',
    'private.example.com/path',
    'private host.example.com',
    '2001:db8::1',
    '999.999.999.999',
  ];

  for (const host of invalidHosts) {
    const result = resolvePrivateNode(`proxies:\n  - name: target\n    server: "${host}"\n    port: 443\n`, 'target');
    assert.deepEqual(result, {
      ok: false,
      error: { code: 'PRIVATE_NODE_INVALID', message: 'Configured private node could not be resolved' },
    });
    assert.equal(JSON.stringify(result).includes(host), false);
  }
});

test('supports generated Clash YAML with indentless proxy items and stops at the next top-level mapping', () => {
  const config = `
proxies:
- name: "Private VPS"
  type: vless
  server: indentless.example.com
  port: 8443
  uuid: do-not-retain
proxy-groups:
- name: group-only-name
  server: must-not-be-read.example.com
  port: 443
`;

  assert.deepEqual(resolvePrivateNode(config, 'Private VPS'), {
    ok: true,
    endpoint: { name: 'Private VPS', host: 'indentless.example.com', port: 8443 },
  });
  assert.deepEqual(resolvePrivateNode(config, 'group-only-name'), {
    ok: false,
    error: { code: 'PRIVATE_NODE_NOT_FOUND', message: 'Configured private node could not be resolved' },
  });
});

test('matches node names exactly rather than by substring', () => {
  const result = resolvePrivateNode(`
proxies:
  - name: private-vps-backup
    server: backup.example.com
    port: 443
`, 'private-vps');

  assert.deepEqual(result, {
    ok: false,
    error: { code: 'PRIVATE_NODE_NOT_FOUND', message: 'Configured private node could not be resolved' },
  });
});

test('treats an empty top-level proxies list as a valid list with no matching node', () => {
  assert.deepEqual(resolvePrivateNode('proxies: []\n', 'private-vps'), {
    ok: false,
    error: { code: 'PRIVATE_NODE_NOT_FOUND', message: 'Configured private node could not be resolved' },
  });
  assert.deepEqual(resolvePrivateNode('proxies: [] # generated empty list\n', 'private-vps'), {
    ok: false,
    error: { code: 'PRIVATE_NODE_NOT_FOUND', message: 'Configured private node could not be resolved' },
  });
});

test('rejects duplicate top-level proxies definitions', () => {
  const result = resolvePrivateNode(`
proxies:
  - name: target
    server: first.example.com
    port: 443
proxies:
  - name: target
    server: second.example.com
    port: 8443
`, 'target');

  assert.deepEqual(result, {
    ok: false,
    error: { code: 'CLASH_PROXIES_INVALID', message: 'Clash proxy configuration is invalid' },
  });
});

test('rejects duplicate exact names as ambiguous', () => {
  const result = resolvePrivateNode(`
proxies:
  - name: duplicate
    server: first.example.com
    port: 443
  - name: duplicate
    server: second.example.com
    port: 8443
`, 'duplicate');

  assert.deepEqual(result, {
    ok: false,
    error: { code: 'PRIVATE_NODE_AMBIGUOUS', message: 'Configured private node could not be resolved' },
  });
});

test('rejects duplicate relevant keys inside one proxy entry as malformed', () => {
  const duplicateFields = [
    '    name: target',
    '    server: second.example.com',
    '    port: 8443',
  ];

  for (const duplicateField of duplicateFields) {
    const result = resolvePrivateNode(`
proxies:
  - name: target
    server: first.example.com
    port: 443
${duplicateField}
    password: never-return-this
`, 'target');
    assert.deepEqual(result, {
      ok: false,
      error: { code: 'CLASH_PROXIES_INVALID', message: 'Clash proxy configuration is invalid' },
    });
    assert.equal(JSON.stringify(result).includes('never-return-this'), false);
    assert.equal(JSON.stringify(result).includes('example.com'), false);
  }
});

test('ignores duplicate unrelated keys without retaining or returning their values', () => {
  const result = resolvePrivateNode(`
proxies:
  - name: target
    server: safe.example.com
    port: 443
    uuid: first-secret
    uuid: second-secret
`, 'target');

  assert.deepEqual(result, {
    ok: true,
    endpoint: { name: 'target', host: 'safe.example.com', port: 443 },
  });
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('rejects malformed matching nodes and never includes sensitive values in errors', () => {
  const invalidNodes = [
    '    server: ""\n    port: 443',
    '    server: host.example.com\n    port: 0',
    '    server: host.example.com\n    port: 65536',
    '    server: host.example.com\n    port: 1.5',
    '    port: 443',
  ];

  for (const node of invalidNodes) {
    const result = resolvePrivateNode(`
proxies:
  - name: target
${node}
    uuid: super-secret-uuid
    password: super-secret-password
`, 'target');
    assert.deepEqual(result, {
      ok: false,
      error: { code: 'PRIVATE_NODE_INVALID', message: 'Configured private node could not be resolved' },
    });
    assert.equal(JSON.stringify(result).includes('super-secret'), false);
    assert.equal(JSON.stringify(result).includes('host.example.com'), false);
  }
});

test('rejects proxy entries without a name and malformed top-level proxy configuration', () => {
  assert.deepEqual(resolvePrivateNode(`
proxies:
  - server: unnamed.example.com
    port: 443
`, 'target'), {
    ok: false,
    error: { code: 'CLASH_PROXIES_INVALID', message: 'Clash proxy configuration is invalid' },
  });

  for (const content of ['', 'proxies: scalar\n', 'proxies:\n  name: not-a-list\n']) {
    assert.deepEqual(resolvePrivateNode(content, 'target'), {
      ok: false,
      error: { code: 'CLASH_PROXIES_INVALID', message: 'Clash proxy configuration is invalid' },
    });
  }
});

test('rejects a blank configured identity without reflecting it', () => {
  assert.deepEqual(resolvePrivateNode('proxies: []\n', '   '), {
    ok: false,
    error: { code: 'PRIVATE_NODE_NAME_INVALID', message: 'Private node identity is invalid' },
  });
});
