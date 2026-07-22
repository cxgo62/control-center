# Network Card-Wide Uptime Hover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any point within a network target card select and display its horizontally corresponding uptime bucket.

**Architecture:** Lift hover tracking and tooltip rendering to `NetTargetRow`. A pure helper converts a pointer's card-border-box X coordinate to the explicit 10px-inset content box, selects the bucket, and returns a clamped row-relative pixel position; `UptimeBar` stays visual-only.

**Tech Stack:** TypeScript, React 18, Node test runner, Vite.

---

### Task 1: Test and implement card-wide hover tracking

**Files:**
- Modify: `client/test/uptime-bar-tooltip.test.ts`
- Modify: `client/src/components/uptime-bar-tooltip.ts`
- Modify: `client/src/components/NetworkPage.tsx:120-220`

- [ ] **Step 1: Write the failing mapping test**

Add failing tests for a new `cardHoverPosition(offsetX, cardWidth, inset, count)` helper. With a 300px border box, 10px content inset, and 48 buckets, assert an offset at/before the content start maps to bucket 0 / `x: 10`, a middle content offset maps to the middle bucket / its row-relative pixel, and an offset at/beyond the content end maps to bucket 47 / `x: 290`.

- [ ] **Step 2: Run the test and confirm it fails if the full-width case is absent**

Run: `cd client && npm test`

Expected: FAIL because `cardHoverPosition` does not exist.

- [ ] **Step 3: Lift hover state to `NetTargetRow`**

Add `cardHoverPosition` alongside the existing pure helpers. It clamps to the explicit 10px horizontal content inset (`9px` card padding plus `1px` border), calculates the content width as `cardWidth - 20`, delegates bucket selection to `bucketIndexAtOffset`, and returns the clamped row-relative `x` pixel. In `NetTargetRow`, track its `{ index, x }` result on `onMouseMove` using the row's border-box `getBoundingClientRect()` width; clear state on row leave. Keep the card's appearance unchanged.

- [ ] **Step 4: Make `UptimeBar` and the row tooltip responsibilities explicit**

Remove hover state, event handlers, and tooltip markup from `UptimeBar`, leaving it gradient-only. Render the tooltip as an absolutely positioned child of `NetTargetRow`, at the helper's row-relative `x` pixel; use the selected bucket's existing interval/state formatter. This anchors it above the actual pointer/card coordinate, not inside the 60%-wide bar.

- [ ] **Step 5: Verify and manually test**

Run: `cd client && npm test && npm run build`

Open `http://localhost:5173/#network`; hover left/middle/right positions in the name, metric, and bar areas of a target card. Confirm identical x positions choose identical time buckets and leaving the card hides the tooltip.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/NetworkPage.tsx client/src/components/uptime-bar-tooltip.ts client/test/uptime-bar-tooltip.test.ts
git commit -m "feat: expand uptime hover target to card"
```
