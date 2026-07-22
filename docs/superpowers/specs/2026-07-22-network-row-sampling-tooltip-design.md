# Network Row Sampling-Time Tooltip Design

## Goal

Show the exact sampling time for the latency currently displayed on every domestic and international network target row when the user hovers the row.

## Scope

This change applies to the target rows rendered by `NetTargetRow` in the network dashboard. It does not add historical-bucket inspection, chart tooltips, or a new API route.

## Data Contract

- Each network destination returned by `GET /api/network/data` includes `probedAt`, the timestamp of its latest persisted probe for that target and path. Destinations without a probe return `null`.
- `GET /api/network/ping` returns each target's `probedAt` timestamp alongside its live status and latency. The timestamp is recorded when the server completes that target's probe.
- The client type definitions reflect those nullable persisted and live timestamps.
- Applying a live ping result replaces the row's displayed `up`, `latencyMs`, and `probedAt` together. This preserves the semantic link between the displayed latency and its sampling time.

## Interaction and Presentation

- Hovering or keyboard-focusing a target row shows a non-interactive tooltip above the row, centered horizontally.
- Tooltip text is `采样时间 · 今天 HH:mm:ss` for today and an unambiguous local date-and-time for older samples.
- The timestamp uses the browser's local timezone.
- A row with no timestamp does not display a tooltip.
- The tooltip is positioned and layered so it does not cover the row's measurements or become hidden behind neighboring rows or the parent card.
- It appears and disappears with a short opacity transition and does not alter layout or intercept pointer events.

## Error Handling

- Existing network request error behavior remains unchanged.
- Missing or malformed timestamps degrade gracefully: no tooltip is rendered rather than rendering an invalid date.

## Verification

- Add server tests covering latest persisted per-target timestamps in `/api/network/data` and timestamp presence in live-ping payload construction where practical.
- Add focused client tests, or a small extracted formatter unit test if no component test framework is configured, for today/older/missing timestamp formatting.
- Manually verify direct and proxy rows in the dashboard: hovering a row shows its latest timestamp, a live ping refreshes the timestamp, and rows with no data remain tooltip-free.
