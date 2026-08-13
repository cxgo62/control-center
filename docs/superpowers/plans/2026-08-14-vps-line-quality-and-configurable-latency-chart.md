# VPS Line Quality and Configurable Latency Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a compact network page with direct Bandwagon VPS route monitoring and a configuration-driven multi-series latency chart.

**Architecture:** A low-frequency Clash node resolver feeds a cached endpoint to an independent one-minute ICMP/TCP monitor. Aggregate samples are stored in SQLite and exposed through normalized APIs; the React page consumes generic series and VPS bucket contracts with synchronized SVG hover behavior.

**Tech Stack:** TypeScript, Fastify, Node child processes and sockets, SQLite/better-sqlite3, React 18, SVG, Node test runner.

---

## File map

- Create `server/src/vps-line/metrics.ts`: pure RTT statistics, bucket aggregation, and quality classification.
- Create `server/src/vps-line/node-resolver.ts`: allowlisted Clash proxy parsing and cached low-frequency discovery.
- Create `server/src/vps-line/probe-runner.ts`: safe ICMP process and TCP connection adapters.
- Create `server/src/vps-line/monitor.ts`: discovery/probe scheduling, recovery, persistence, and lifecycle logging.
- Modify `server/src/config.ts`: private-node name and generic latency-series configuration.
- Modify `server/src/db.ts`: VPS aggregate-sample schema and queries.
- Modify `server/src/routes/network.ts`: generic latency series and VPS route endpoint.
- Modify `server/src/index.ts`: start and stop the VPS monitor.
- Create `server/test/vps-line-*.test.ts`: focused resolver, statistics, monitor, API, and sanitization coverage.
- Create `client/src/components/network-chart-utils.ts`: generic bucket hover and tooltip positioning.
- Modify `client/src/types.ts`, `client/src/api.ts`: normalized series and VPS response contracts.
- Modify `client/src/components/NetworkPage.tsx`: compact status bar, VPS card, and generic four-series chart.
- Create `client/test/network-chart-utils.test.ts`: synchronized and missing-data hover tests.
- Modify `README.md`: `VPS_LINE_NODE_NAME`, monitor behavior, and deployment note.

### Task 1: Pure configuration and metric contracts

**Files:**
- Modify: `server/src/config.ts`
- Create: `server/src/vps-line/metrics.ts`
- Test: `server/test/vps-line-metrics.test.ts`
- Test: `server/test/network-series-config.test.ts`

- [ ] Write failing tests for the initial series order (`domestic`, `international`, `chatgpt`, `google`), target/group validation, exact median/P95/jitter calculations, five-minute minimum sample rule, all threshold boundaries, special ICMP/TCP states, and deterministic bucket reductions.
- [ ] Run `cd server && npm test -- test/vps-line-metrics.test.ts test/network-series-config.test.ts`; expect failures because exports do not exist.
- [ ] Add `VPS_LINE_NODE_NAME` normalization and `NET_LATENCY_SERIES` typed configuration. Implement pure helpers with `number | null` outputs and explicit `up | intermittent | down | unknown` TCP bucket state.
- [ ] Re-run the focused tests, then `cd server && npm test`; expect all tests to pass.
- [ ] Commit with `git commit -m "feat: define VPS line metrics and chart series"`.

### Task 2: Safe private-node discovery and probe execution

**Files:**
- Create: `server/src/vps-line/node-resolver.ts`
- Create: `server/src/vps-line/probe-runner.ts`
- Test: `server/test/vps-line-resolver.test.ts`
- Test: `server/test/vps-line-probe-runner.test.ts`

- [ ] Write failing resolver tests using synthetic Clash snippets for exact-name matching, quoted scalars, address/port changes, missing/malformed nodes, duplicate names, and proof that returned/errors do not contain UUID/password/subscription values.
- [ ] Implement a focused line/state parser for the generated `proxies:` list that allowlists only `name`, `server`, and integer `port`; reject ambiguous duplicates and invalid host/port values.
- [ ] Write failing probe tests around injected spawn/socket adapters: 10 replies, partial/all loss, macOS ping summary variants, timeout, TCP success/failure, and arguments containing a hostile hostname that must remain a single spawn argument.
- [ ] Implement `runIcmpProbe` with `spawn(command, args, { shell: false })`, a finite kill timer, strict numeric parsing, and `runTcpProbe` with `net.createConnection` plus timeout cleanup. Implement a pure `createProbeSample` calculation.
- [ ] Run the two focused test files and the full server suite; expect all tests to pass.
- [ ] Commit with `git commit -m "feat: resolve and probe private Clash node"`.

### Task 3: Persistence and monitor lifecycle

**Files:**
- Modify: `server/src/db.ts`
- Create: `server/src/vps-line/monitor.ts`
- Modify: `server/src/index.ts`
- Test: `server/test/vps-line-monitor.test.ts`

- [ ] Write failing tests for sample insert/query, 30-day cleanup, missing configuration, startup discovery, 60-second probe scheduling, debounced file rediscovery, 30-minute fallback, three-failure early rediscovery with cooldown, endpoint invalidation, recovery, and sanitized structured log payloads.
- [ ] Add `vps_line_samples` with timestamps, node identity, sent/received, median/P95/jitter, TCP and ICMP states plus an indexed query. Keep resolved host/port out of the table.
- [ ] Implement a dependency-injected monitor with `start()`, `probeNow()`, `getDiscoveryState()`, and `stop()`. Use `fs.watch` only as a trigger; always re-read through the resolver. Keep timer handles and close the watcher on shutdown.
- [ ] Wire startup/shutdown in `server/src/index.ts`; log lifecycle and failures through Fastify/Pino structured methods with stable codes and no raw command/config data.
- [ ] Run the focused monitor tests and full server tests/build.
- [ ] Commit with `git commit -m "feat: persist and schedule VPS line probes"`.

### Task 4: Normalized APIs and generic latency series

**Files:**
- Modify: `server/src/routes/network.ts`
- Create or extend: `server/test/network-utils.test.ts`
- Create: `server/test/vps-line-route.test.ts`

- [ ] Write failing tests that build group and target series from configuration into exactly 48 timestamped buckets, preserve missing data as `null`, skip invalid series with a sanitized warning, and return VPS unconfigured/discovery/error/success states without endpoint details.
- [ ] Replace `lineDomestic`/`lineInternational` with `latencySeries[]`; reuse existing net probes/group stats according to each configured `source` and `path`.
- [ ] Add `GET /api/network/vps-line?range=...` using the pure 48-bucket aggregator and current monitor state. Return the selected-range packet-loss summary separately from the five-minute metrics used for quality classification, with safe local codes/messages only.
- [ ] Run route/unit tests, full server tests, and `npm run build` in `server`.
- [ ] Commit with `git commit -m "feat: expose VPS quality and configurable latency series"`.

### Task 5: Generic chart helpers and client contracts

**Files:**
- Modify: `client/src/types.ts`
- Modify: `client/src/api.ts`
- Create: `client/src/components/network-chart-utils.ts`
- Create: `client/test/network-chart-utils.test.ts`

- [ ] Write failing tests for generic N-series hover selection, shared timestamp bucket selection, missing values displayed as `无数据`, VPS latency/loss synchronized selection, and tooltip clamping at both edges.
- [ ] Add typed `LatencySeries`, `VpsLineBucket`, and discriminated VPS response contracts plus `api.getVpsLine(range)`.
- [ ] Implement pure hover/tooltip helpers that never assume ChatGPT, Google, or a fixed series count.
- [ ] Run focused and full client tests.
- [ ] Commit with `git commit -m "feat: add generic network chart contracts"`.

### Task 6: Network page UI and deployment documentation

**Files:**
- Modify: `client/src/components/NetworkPage.tsx`
- Modify: `README.md`

- [ ] Replace `SummaryCard` with a compact cross-column status bar and update the content grid to `46px 1fr 1fr`, preserving the sidebar and current connectivity cards.
- [ ] Add the VPS card with loading, unconfigured, accumulating, good/degraded/poor, ICMP-unavailable, TCP-failed, and discovery-failed states. Render median latency plus the aligned loss band with one crosshair and a combined tooltip containing time interval, median, P95, loss percentage, lost/sent, jitter, and TCP state; missing buckets say `该时段无探测数据`.
- [ ] Refactor the latency chart to iterate `latencySeries[]`, render configured colors/legends, break paths on `null`, and show all configured values in one hover tooltip.
- [ ] Document `VPS_LINE_NODE_NAME`, the low-frequency discovery/high-frequency probe split, privacy behavior, and the production restart command.
- [ ] Run `npm test && npm run build` in both `server` and `client`; run `git diff --check` and inspect `git status --short`.
- [ ] Use the exact production command discovered from repository scripts/launchd state, then verify `/api/network/data`, `/api/network/vps-line`, and the rendered network page at desktop and narrow widths; confirm structured logs have timestamps and no endpoint/secret leakage.
- [ ] Commit with `git commit -m "feat: ship VPS network quality dashboard"`.

### Task 7: Final integration and production rollout

**Files:**
- No expected source changes unless verification finds a defect.

- [ ] Use `superpowers:verification-before-completion` and run a requirement-by-requirement audit against the design spec.
- [ ] Use `superpowers:requesting-code-review` once for a focused final code review; fix only concrete correctness/security issues and re-run affected tests.
- [ ] Merge the feature branch into local `main` without rewriting unrelated history.
- [ ] Rebuild and restart the configured production Control Center service using the repository’s existing production workflow.
- [ ] Verify the live production URL/API, wait through at least one VPS probe round, and confirm a sample is persisted or the correctly configured card-local state is shown.
- [ ] Use `superpowers:finishing-a-development-branch` to report the final branch/worktree state.
