# Network Uptime-Bar Time Tooltip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the time interval and state represented by the hovered uptime-bar bucket.

**Architecture:** The server enriches each bucket with its existing calculated range boundaries in epoch milliseconds. The client extracts deterministic range/bucket helpers for tests, maps the pointer offset to one bucket, and renders a bar-local tooltip; it removes the row-level latest-sample tooltip.

**Tech Stack:** TypeScript, Fastify, Node test runner, React 18, Vite.

---

### Task 1: Return precise bucket boundaries

**Files:**
- Modify: `server/src/routes/network.ts:28-89`
- Modify: `server/test/network-utils.test.ts`

- [ ] **Step 1: Write a failing bucket-boundary test**

Call `buildBuckets` with `sinceMs: 0`, `nowMs: 4800`, and a known probe. Assert the first returned bucket is `{ startAt: 0, endAt: 100 }`, the last is `{ startAt: 4700, endAt: 4800 }`, and adjacent buckets share their boundary.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd server && npm test`

Expected: FAIL because buckets have no `startAt` or `endAt`.

- [ ] **Step 3: Add timestamps to the server bucket shape**

Extend `BucketData` with numeric `startAt` / `endAt`. In `buildBuckets`, calculate each existing `bucketStart` / `bucketEnd` once and include them in all three bucket return paths, keeping the existing latency and availability calculations unchanged.

- [ ] **Step 4: Verify server tests and build**

Run: `cd server && npm test && npm run build`

Expected: all tests pass and TypeScript compiles.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/network.ts server/test/network-utils.test.ts
git commit -m "feat: expose uptime bucket time bounds"
```

### Task 2: Add tested client time and pointer helpers

**Files:**
- Create: `client/src/components/uptime-bar-tooltip.ts`
- Create: `client/test/uptime-bar-tooltip.test.ts`
- Modify: `client/src/types.ts:35-43`

- [ ] **Step 1: Write failing client tests**

Test a `bucketIndexAtOffset(offsetX, width, count)` helper for first (`0`), middle, final, and an exact-right-edge offset (must return `count - 1`). Test `formatBucketTooltip(bucket, now)` for same-day normal, down, no-data, cross-midnight, and invalid/missing values.

- [ ] **Step 2: Run client tests and confirm failure**

Run: `cd client && npm test`

Expected: FAIL because the helper module does not exist.

- [ ] **Step 3: Implement pure helpers and client types**

Add `startAt` and `endAt` to `NetBucket`. Implement the index helper by clamping `Math.floor(offsetX / width * count)` into `[0, count - 1]`. Implement browser-local formatting as `HH:mm:ss–HH:mm:ss · 正常|断线|无数据`, using full `YYYY-MM-DD HH:mm:ss` values when the interval crosses a local calendar day; invalid data returns `null`.

- [ ] **Step 4: Verify client tests and build**

Run: `cd client && npm test && npm run build`

Expected: all tests pass and TypeScript compiles.

- [ ] **Step 5: Commit**

```bash
git add client/src/types.ts client/src/components/uptime-bar-tooltip.ts client/test/uptime-bar-tooltip.test.ts
git commit -m "feat: add uptime bar tooltip helpers"
```

### Task 3: Render the bar-local tooltip

**Files:**
- Modify: `client/src/components/NetworkPage.tsx:121-230`
- Delete: `client/src/components/network-time.ts`
- Delete: `client/test/network-time.test.ts`

- [ ] **Step 1: Remove superseded row-time artifacts**

Delete `client/src/components/network-time.ts` and `client/test/network-time.test.ts`. The new `uptime-bar-tooltip` tests from Task 2 replace their coverage, and no production code should format `NetDest.probedAt` for a row-level tooltip.

- [ ] **Step 2: Replace row-level hover with bar-level tracking**

Delete `NetTargetRow`'s whole-row hover state and latest-sample tooltip. In `UptimeBar`, track `{ index, xPercent }` from `onMouseMove`, where `xPercent` is the bar-relative pointer position `(event.clientX - rect.left) / rect.width * 100` clamped to `0–100`, and `index` is selected by the pure index helper. Clear both on mouse leave. Render its non-interactive tooltip only when the formatter returns text, at `left: ${xPercent}%` so it sits above the actual hover position rather than the bucket center.

- [ ] **Step 3: Preserve layout and layering**

Keep the bar's 60% width and existing gradient. Set the bar wrapper to `position: relative`; use a high local z-index and `pointerEvents: 'none'` for the tooltip. Retain the card's visible overflow only if required for the popup, without changing row dimensions.

- [ ] **Step 4: Verify full suite and manual behavior**

Run: `cd server && npm test && npm run build && cd ../client && npm test && npm run build`

Then open `http://localhost:5173/#network` and verify at least `1 小时` and `24 小时`: hover the left/middle/right parts of a domestic and international uptime bar, and verify time interval/state changes with the hovered segment. Verify an empty segment reads `无数据` and hovering row content outside the bar shows no bubble.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/NetworkPage.tsx client/src/components/network-time.ts client/test/network-time.test.ts
git commit -m "feat: show uptime bucket time on hover"
```
