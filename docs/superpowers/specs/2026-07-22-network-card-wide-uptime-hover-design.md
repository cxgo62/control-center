# Network Card-Wide Uptime Hover Design

## Goal

Make each network target card an easy-to-hit hover surface for the uptime timeline.

## Interaction

- Hovering anywhere inside a target card—name, metrics, or uptime bar—shows the uptime tooltip.
- The card's full content width maps linearly to its 48 time buckets: left edge selects bucket 0 and right edge selects bucket 47, with exact-right-edge clamping to the final bucket.
- Vertical mouse position does not affect bucket selection.
- The tooltip stays above the card at the pointer's horizontal position and continues to display the selected bucket interval and `正常`, `断线`, or `无数据` state.
- Moving between target cards updates the tooltip for that card only; leaving a card hides it.

## Verification

- Extend client helper tests for full-card width mapping and exact-right-edge clamping.
- Manually hover the left, middle, and right sides of card text, metric, and bar areas; verify the same horizontal position yields the same time bucket.
