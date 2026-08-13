# Control Center Nginx Subpath Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the existing control center at `/control-center/` through the current Nginx/Cloudflare path, retain Vite's internal API proxy, and remove the local `damkeeper.top` loopback hosts override without adding ports or changing Cloudflare.

**Architecture:** Nginx preserves `/control-center/` and proxies it to the existing control-center Vite listener at `[::1]:5173`. Vite owns the base path and rewrites `/control-center/api/*` to `/api/*` before forwarding to the existing Fastify listener on port `9000`. The existing Nginx `/cx-tools/` and `/` routes remain intact, while `/etc/hosts` returns domain resolution to normal DNS.

**Tech Stack:** TypeScript, Vite 5, Node test runner, Nginx 1.29, macOS launchd and resolver.

---

## File Map

- Create `client/src/control-center-paths.ts`: single source of truth for the public base path, API URL construction, and Vite proxy path rewrite.
- Create `client/test/control-center-paths.test.ts`: path behavior regression tests.
- Modify `client/src/api.ts`: use the public base-path helper for every API request.
- Modify `client/vite.config.ts`: configure the public base and the prefixed API proxy while keeping direct `/api` development compatibility.
- Modify `/opt/homebrew/etc/nginx/servers/cloudflare-gateway.conf`: add the two control-center locations only; preserve `/cx-tools/` and `/`.
- Modify `/etc/hosts`: remove only the `damkeeper.top`/`www.damkeeper.top` loopback line.

### Task 1: Define and test public path behavior

**Files:**
- Create: `client/test/control-center-paths.test.ts`
- Create: `client/src/control-center-paths.ts`

- [ ] **Step 1: Write the failing path tests**

```ts
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
```

- [ ] **Step 2: Run the test and verify RED**

Run: `cd client && node --import tsx --test --test-name-pattern='control-center public|browser API|rewrites prefixed' test/control-center-paths.test.ts`

Expected: FAIL because `../src/control-center-paths.js` does not exist.

- [ ] **Step 3: Implement the minimal path helper**

```ts
export const CONTROL_CENTER_BASE_PATH = '/control-center/';

export function apiPath(path: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${CONTROL_CENTER_BASE_PATH}api${suffix}`;
}

export function stripControlCenterBase(path: string): string {
  const prefix = CONTROL_CENTER_BASE_PATH.slice(0, -1);
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}
```

- [ ] **Step 4: Run the focused and complete client suites**

Run: `cd client && node --import tsx --test --test-name-pattern='control-center public|browser API|rewrites prefixed' test/control-center-paths.test.ts`

Expected: PASS for all three new tests.

Run: `cd client && npm test`

Expected: all client tests PASS without warnings.

- [ ] **Step 5: Commit the path contract**

```bash
git add client/src/control-center-paths.ts client/test/control-center-paths.test.ts
git commit -m "test: define control center public paths"
```

### Task 2: Route client API calls and Vite traffic under the base path

**Files:**
- Modify: `client/src/api.ts`
- Modify: `client/vite.config.ts`
- Modify: `client/test/control-center-paths.test.ts`

- [ ] **Step 1: Extend the failing test to inspect Vite configuration**

Add an import for `../vite.config.js` and assertions that:

```ts
assert.equal(viteConfig.base, CONTROL_CENTER_BASE_PATH);
assert.ok(viteConfig.server?.proxy?.['/control-center/api']);
assert.ok(viteConfig.server?.proxy?.['/api']);
```

Run: `cd client && node --import tsx --test --test-name-pattern='configures Vite' test/control-center-paths.test.ts`

Expected: FAIL because Vite has no `base` and no `/control-center/api` proxy.

- [ ] **Step 2: Configure Vite with the shared base and proxy rewrite**

Update `client/vite.config.ts` to import the shared helpers and define:

```ts
const apiTarget = 'http://localhost:9000';

export default defineConfig({
  base: CONTROL_CENTER_BASE_PATH,
  plugins: [react()],
  server: {
    proxy: {
      [`${CONTROL_CENTER_BASE_PATH}api`]: {
        target: apiTarget,
        rewrite: stripControlCenterBase,
      },
      '/api': apiTarget,
    },
  },
  build: { outDir: 'dist' },
});
```

- [ ] **Step 3: Replace root-relative fetch URLs**

Import `apiPath` in `client/src/api.ts` and wrap every `/api/...` fetch URL. Preserve query strings and HTTP options. Examples:

```ts
getServices: () => fetch(apiPath('/services')).then(r => r.json()),
getNetworkData: (range: string) =>
  fetch(`${apiPath('/network/data')}?range=${range}`).then(r => r.json()),
```

- [ ] **Step 4: Run tests and production build**

Run: `cd client && npm test`

Expected: all client tests PASS.

Run: `cd client && npm run build`

Expected: TypeScript and Vite build succeed; `client/dist/index.html` references `/control-center/assets/`.

- [ ] **Step 5: Commit client routing support**

```bash
git add client/src/api.ts client/vite.config.ts client/test/control-center-paths.test.ts
git commit -m "feat: support control center subpath"
```

### Task 3: Install and validate the Nginx route

**Files:**
- Modify: `/opt/homebrew/etc/nginx/servers/cloudflare-gateway.conf`
- Backup: `/opt/homebrew/etc/nginx/servers/cloudflare-gateway.conf.bak.pre-control-center-<timestamp>`

- [ ] **Step 1: Record current config and create an explicit backup**

Copy the gateway file to a timestamped sibling backup before mutation. Confirm its checksum matches the original.

- [ ] **Step 2: Prepare the edited gateway file through a temporary copy**

Use `apply_patch` on a temporary copy to insert before `/cx-tools`:

```nginx
location = /control-center {
    return 308 /control-center/;
}

location ^~ /control-center/ {
    proxy_pass http://[::1]:5173;
    proxy_http_version 1.1;

    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 300s;
}
```

The lack of a trailing slash on `proxy_pass` is required to preserve `/control-center/` upstream.

- [ ] **Step 3: Install and validate before reload**

Install the prepared file at the exact gateway path, then run `nginx -t`.

Expected: `syntax is ok` and `test is successful`. If validation fails, restore the backup and do not reload.

- [ ] **Step 4: Restart control-center and reload Nginx**

Run `launchctl kickstart -k gui/$(id -u)/com.cx.control-center`, wait until `[::1]:5173` and `*:9000` are listening, then run `nginx -s reload`.

Expected: both existing control-center listeners return and Nginx reload exits successfully.

- [ ] **Step 5: Verify the Nginx path flow locally**

Use a request forced to the existing Nginx listener without relying on public DNS:

```bash
curl --resolve damkeeper.top:8088:127.0.0.1 -I http://damkeeper.top:8088/control-center
curl --resolve damkeeper.top:8088:127.0.0.1 -D - http://damkeeper.top:8088/control-center/
curl --resolve damkeeper.top:8088:127.0.0.1 -D - http://damkeeper.top:8088/control-center/api/services
```

Expected: one `308` redirect, then HTML `200` without another redirect, and API JSON `200`. Extract an asset URL from the HTML and verify it also returns `200`. Smoke-check `/cx-tools/` and `/` and confirm their configured upstreams were not edited.

- [ ] **Step 6: Roll back immediately if reload or smoke checks fail**

Do not begin the hosts-file change while any Nginx smoke check is failing. Restore the timestamped Nginx backup, run `nginx -t`, reload Nginx, revert the isolated client subpath commit, restart `com.cx.control-center`, and verify direct `5173` access returns to its pre-change behavior. Record the failing response and logs before retrying implementation. If `/etc/hosts` was already changed for any reason, restore its timestamped backup with owner `root:wheel` and mode `0644`, then refresh the macOS DNS cache.

### Task 4: Remove the local domain override and verify public resolution

**Files:**
- Modify: `/etc/hosts`
- Backup: `/etc/hosts.bak.pre-control-center-<timestamp>`

- [ ] **Step 1: Back up and prepare `/etc/hosts`**

Create a root-owned timestamped backup. Copy `/etc/hosts` to a temporary writable file and use `apply_patch` to remove only:

```text
# Local direct access to the Damkeeper service on this Mac mini.
127.0.0.1 damkeeper.top www.damkeeper.top
```

- [ ] **Step 2: Verify the prepared hosts file before installation**

Confirm the temporary file no longer maps either domain to `127.0.0.1`, and confirm the localhost and Cloudflare Tunnel edge-host entries remain byte-for-byte present.

- [ ] **Step 3: Install the hosts file and refresh DNS caches**

Install the prepared file as `/etc/hosts` with owner `root:wheel` and mode `0644`. Run `dscacheutil -flushcache` and signal `mDNSResponder` to reload resolver state.

- [ ] **Step 4: Verify resolution and public access**

Run `dscacheutil -q host -a name damkeeper.top` and confirm no result is `127.0.0.1`. Then request `https://damkeeper.top/control-center/` and confirm it reaches Cloudflare Access or the authenticated control-center route, rather than the local Nginx shortcut.

- [ ] **Step 5: Roll back the hosts edit if public resolution verification fails**

Restore the timestamped `/etc/hosts` backup, confirm owner `root:wheel` and mode `0644`, refresh the DNS cache, and verify the former loopback mapping is active again. If the failure originates from the new Nginx/client path rather than DNS, also follow Task 3 Step 6 so all affected layers return to their pre-change state.

### Task 5: Final regression verification

**Files:**
- No additional changes expected.

- [ ] **Step 1: Run all project test suites**

Run: `cd client && npm test && npm run build`

Run: `cd server && npm test && npm run build`

Expected: all tests and both builds PASS.

- [ ] **Step 2: Revalidate live configuration and listeners**

Run `nginx -t`, inspect the active gateway config, and inspect listeners on `5173`, `9000`, and `8088`.

Expected: Nginx validation succeeds; no new port is listening; `/cx-tools/` still points to `127.0.0.1:6177`; `/` still points to `192.168.31.193:5177`; `/control-center/` points only to `[::1]:5173`.

- [ ] **Step 3: Inspect logs for lifecycle and proxy errors**

Inspect the timestamped Nginx access/error logs and the structured control-center logs after smoke tests. Confirm no new upstream, redirect-loop, or API proxy errors occurred.

- [ ] **Step 4: Confirm the worktree is intentional**

Run `git status --short` and `git diff --check`. Review that only the planned client, test, specification, and plan files changed.
