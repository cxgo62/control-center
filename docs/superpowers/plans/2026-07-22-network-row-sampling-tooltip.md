# Network Row Sampling-Time Tooltip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the exact sampling time associated with the latency displayed in each network target row on hover.

**Architecture:** The network API will carry a nullable per-target `probedAt` timestamp from persisted records and from foreground live pings. The client will keep latency, state, and timestamp together when applying live updates, then render a CSS-only non-interactive tooltip using a small timestamp formatter.

**Tech Stack:** TypeScript, Fastify, Node test runner, React 18, Vite, inline React style objects.

---

## File Structure

- Modify `server/src/routes/network-utils.ts`: expose pure, testable helpers for locating a target's latest persisted probe timestamp and creating live-ping payload entries.
- Modify `server/src/routes/network.ts`: export and use the persisted destination payload builder, and add `probedAt` to persisted destination and live-ping response payloads.
- Modify `server/test/network-utils.test.ts`: cover the latest-target-timestamp helper's populated and empty inputs.
- Modify `client/src/types.ts`: add nullable `probedAt` to `NetDest`.
- Create `client/src/components/network-time.ts`: provide the pure browser-local sampling-time formatter.
- Create `client/test/network-time.test.ts`: cover today, historical, missing, and invalid timestamp formatting.
- Modify `client/package.json`: add a client test script and the `tsx` test-time dev dependency.
- Modify `client/src/components/NetworkPage.tsx`: type live ping timestamps, retain them during live overrides, format timestamps, and render the hover tooltip.

### Task 1: Add per-target persisted sampling timestamps

**Files:**
- Modify: `server/src/routes/network-utils.ts`
- Modify: `server/test/network-utils.test.ts`
- Modify: `server/src/routes/network.ts:38-88`

- [ ] **Step 1: Write failing helper tests**

Add Node tests for `latestProbeForTarget(probes, destId)` that assert it returns the probe with the greatest `probed_at` for the requested `dest_id`, and `null` when no matching probe exists. Include probes from another target so destination filtering is verified. Also add a test for the exported persisted response builder in `network.ts`: pass probes with a known latest record and assert its returned destination payload exposes `probedAt` with that exact value.

- [ ] **Step 2: Run the server test to verify failure**

Run: `cd server && npm test`

Expected: FAIL because `latestProbeForTarget` is not exported.

- [ ] **Step 3: Implement the minimal pure helper**

In `server/src/routes/network-utils.ts`, export a helper accepting objects with `dest_id` and `probed_at`. Iterate once, retain the matching record with the largest `probed_at`, and return `null` if none match. Do not use a spread-and-sort allocation. Export `createLivePingEntry(id, path, group, result, probedAt)` to attach a supplied completion timestamp to a live probe result; keep this function free of I/O so its response shape is directly testable.

- [ ] **Step 4: Use the helper in the route response builder**

In `buildBuckets` in `server/src/routes/network.ts`, use the new helper instead of its local sorted copy. Export the persisted destination builder used by `GET /api/network/data` so the test exercises the same code path as the endpoint. Return `probedAt: latestProbe?.probed_at ?? null` with `up`, `latencyMs`, `avail`, and `buckets`; add the nullable field to `NetDestResponse`.

- [ ] **Step 5: Run server tests**

Run: `cd server && npm test`

Expected: PASS, including existing `latestProbedAt` tests, the new per-target API-payload timestamp test, and the live-ping-entry shape test.

- [ ] **Step 6: Commit the backend persisted-timestamp change**

```bash
git add server/src/routes/network-utils.ts server/src/routes/network.ts server/test/network-utils.test.ts
git commit -m "feat: expose network target probe timestamps"
```

### Task 2: Return timestamps for live pings and preserve them in client state

**Files:**
- Modify: `server/src/routes/network.ts:155-172`
- Modify: `client/src/types.ts:45-54`
- Modify: `client/src/components/NetworkPage.tsx:630-699`

- [ ] **Step 1: Extend foreground ping payload construction**

At each fulfilled `probeTarget` promise in the `/api/network/ping` handler, call `createLivePingEntry` with `Date.now()` after that target's probe completes. Update the response record's TypeScript shape so `up`, `latencyMs`, and `probedAt` travel together for both direct and proxy paths. The Task 1 test must assert the helper returns `probedAt` unchanged, proving the live endpoint's payload-construction contract.

- [ ] **Step 2: Extend client API data types**

Add `probedAt: number | null` to `NetDest` in `client/src/types.ts`. In `NetworkPage.tsx`, update `PingResult` so each live record contains a numeric `probedAt` field.

- [ ] **Step 3: Preserve the timestamp during the live override**

Update `applyPing` to spread the live `probedAt` along with `up` and `latencyMs`. Ensure a missing live result leaves all persisted fields—including its timestamp—unchanged.

- [ ] **Step 4: Build both projects**

Run: `cd server && npm run build && cd ../client && npm run build`

Expected: both TypeScript builds succeed with the changed response contracts.

- [ ] **Step 5: Commit the live-ping data contract**

```bash
git add server/src/routes/network.ts client/src/types.ts client/src/components/NetworkPage.tsx
git commit -m "feat: carry live network probe timestamps"
```

### Task 3: Render the row-level sampling-time tooltip

**Files:**
- Create: `client/src/components/network-time.ts`
- Create: `client/test/network-time.test.ts`
- Modify: `client/package.json`
- Modify: `client/src/components/NetworkPage.tsx:141-211`

- [ ] **Step 1: Add failing formatter tests**

Create `client/test/network-time.test.ts` with a fixed `now` argument so tests are timezone-independent. Assert `formatSamplingTime(timestamp, now)` returns `采样时间 · 今天 HH:mm:ss` for a same-local-calendar-day value, `采样时间 · YYYY-MM-DD HH:mm:ss` for a prior-day value, and `null` for `null`, `NaN`, and non-finite values. Add `"test": "node --import tsx --test test/*.test.ts"` and `tsx` to `client/package.json` dev dependencies, then install the updated client lockfile if this repository tracks one.

- [ ] **Step 2: Run client formatter test to verify failure**

Run: `cd client && npm test`

Expected: FAIL because `network-time.ts` and `formatSamplingTime` do not exist.

- [ ] **Step 3: Implement the pure timestamp formatter**

Create `client/src/components/network-time.ts` exporting `formatSamplingTime(timestamp, now = new Date())`. It accepts `number | null`, returns `null` for invalid or absent values, and compares local year/month/day fields. For a timestamp on the current calendar day, return `采样时间 · 今天 HH:mm:ss`; otherwise return `采样时间 · YYYY-MM-DD HH:mm:ss`, using zero-padded numeric parts. Import this helper into `NetworkPage.tsx`; do not embed date formatting inside JSX.

- [ ] **Step 4: Run formatter tests**

Run: `cd client && npm test`

Expected: PASS for the same-day, prior-day, null, `NaN`, and infinite timestamp cases.

- [ ] **Step 5: Render tooltip markup only when a formatted value exists**

Add `hovered` state within `NetTargetRow`, set it from `onMouseEnter` / `onMouseLeave`, and wrap the row in a `position: relative` container. Render a sibling tooltip above the row only when a formatted value exists. Use `pointerEvents: 'none'`, a dark elevated surface, a small downward arrow, an opacity/visibility transition, and `zIndex: hovered ? 2 : 1`. Center it with `left: '50%'` and `transform: 'translateX(-50%)'`.

- [ ] **Step 6: Prevent clipping and preserve layout**

In `NetRegionCard`, change the outer card's existing `overflow: 'hidden'` to `overflow: 'visible'`, leaving its sizing, padding, and grid placement unchanged. This allows the upper tooltip to layer above adjacent rows without clipping; the row-level z-index controls which row wins. Confirm no tooltip adds height, shifts adjacent rows, or blocks the pointer.

- [ ] **Step 7: Build the client**

Run: `cd client && npm run build`

Expected: `tsc && vite build` completes successfully.

- [ ] **Step 8: Manually verify in the running dashboard**

Open `http://localhost:5173/#network`. Hover domestic and international rows, confirm the centered tooltip presents the timestamp matching the currently displayed latency, wait for a 10-second live ping refresh and confirm its time changes, and confirm a destination without stored data has no tooltip.

Run: `cd client && npm test`

Expected: timestamp formatter tests pass before visual dashboard verification.

- [ ] **Step 9: Run the full verification suite**

Run: `cd server && npm test && npm run build && cd ../client && npm test && npm run build`

Expected: all tests and builds pass.

- [ ] **Step 10: Commit the UI interaction**

```bash
git add client/package.json client/src/components/network-time.ts client/test/network-time.test.ts client/src/components/NetworkPage.tsx
git commit -m "feat: show network sample time on hover"
```
