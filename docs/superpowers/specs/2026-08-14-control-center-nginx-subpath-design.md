# Control Center Nginx Subpath Design

## Goal

Expose the existing control center at `https://damkeeper.top/control-center/` through the existing Nginx and Cloudflare Tunnel path. Do not change Cloudflare configuration and do not add any listening ports.

Cloudflare Access already protects the domain, so this change does not add a second authentication layer.

## Current Architecture

- Cloudflare Tunnel sends public traffic to the existing Nginx server on port `8088`.
- Nginx currently serves `damkeeper.top`, with `/cx-tools/` routed separately and `/` routed to the existing default application.
- The control-center launch agent starts:
  - Vite on loopback port `5173` for the browser-facing UI.
  - Fastify on port `9000` for backend APIs.
- Browser requests use port `5173`. Vite proxies `/api/*` internally to Fastify on port `9000`.
- Another application also uses port `5173` on the machine's LAN address. The control-center Vite process is specifically bound to IPv6 loopback (`::1:5173`), so Nginx must target that listener rather than the LAN listener.

## Chosen Design

Keep the current browser-to-Vite-to-Fastify architecture intact:

```text
Browser
  -> Cloudflare Access and Tunnel
  -> existing Nginx :8088
  -> /control-center/* proxied to [::1]:5173
  -> Vite proxies /api/* to localhost:9000
```

Nginx will gain two locations in the existing `damkeeper.top` server block:

- Exact `/control-center` requests return a permanent `308` redirect to `/control-center/`.
- `/control-center/` requests proxy to the existing control-center Vite listener at `[::1]:5173`, stripping the `/control-center/` prefix before forwarding upstream.

The existing `/cx-tools/` and `/` locations remain unchanged. No Cloudflare settings, hostnames, DNS records, tunnel ingress rules, or listening ports change.

## Client Path Handling

Vite will use `/control-center/` as its base path. Browser-visible asset URLs will therefore remain under `/control-center/` even though Nginx strips that prefix before sending requests to Vite.

Client API requests will be built from Vite's base URL rather than from the domain root. For example, the browser requests `/control-center/api/services`; Nginx strips `/control-center/` and sends `/api/services` to Vite; Vite then applies its existing `/api` proxy to Fastify on port `9000`.

This keeps all browser traffic on the public Nginx origin and preserves the current internal API proxy behavior observed on port `5173`.

## Proxy Headers and WebSockets

The new Nginx location will preserve the existing gateway conventions:

- HTTP/1.1 upstream connections.
- `Host`, `X-Real-IP`, `X-Forwarded-For`, and `X-Forwarded-Proto` forwarding.
- `Upgrade` and `Connection` headers for Vite WebSocket compatibility.
- The existing `300s` proxy read timeout.

Access and error logging continue through the existing Nginx log files, whose standard Nginx timestamps satisfy the gateway's operational logging needs. No new backend entrypoint is introduced.

## Failure Behavior

- If the control-center Vite process is unavailable, only `/control-center/` returns an Nginx upstream error; existing routes remain unaffected.
- If Fastify is unavailable, Vite returns an API proxy failure while the UI route remains isolated from the other Nginx applications.
- The redirect normalizes the no-trailing-slash URL so relative base-path behavior is deterministic.

## Verification

Automated tests will first establish the required client base-path behavior and fail before the implementation change. After implementation:

1. Client tests verify that API URLs are rooted under `/control-center/api/`.
2. The client production build verifies asset URLs are rooted under `/control-center/`.
3. `nginx -t` validates the complete Nginx configuration before reload.
4. Local requests through Nginx verify the redirect, HTML, static assets, and an API endpoint.
5. Smoke checks confirm `/cx-tools/` and `/` still resolve through their original upstreams.
6. The Nginx reload occurs only after configuration validation succeeds.

## Rollback

Before editing, save a dated backup of the existing Nginx gateway file. Rollback removes the two `/control-center` locations (or restores the backup), restores the client base-path changes, validates with `nginx -t`, and reloads Nginx. Cloudflare requires no rollback because it is not modified.
