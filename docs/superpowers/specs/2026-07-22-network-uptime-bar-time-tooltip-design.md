# Network Uptime-Bar Time Tooltip Design

## Goal

Show the actual time interval represented by the hovered position in each network target's uptime bar, rather than the row's latest sampling time.

## Data Contract

- Every uptime bucket returned by `GET /api/network/data` includes its server-calculated `startAt` and `endAt` timestamps in addition to `up`, `latencyMs`, and `hasData`.
- The 48 buckets remain mutually contiguous and cover exactly the selected API range.

## Interaction

- Only the uptime bar is hoverable for this feature; hovering other parts of a row shows no sampling-time bubble.
- The pointer maps to one of the 48 rendered buckets. The tooltip displays that bucket's local-time interval as `HH:mm:ss–HH:mm:ss` when both endpoints are on the same day, otherwise an unambiguous date-and-time interval.
- It also displays the bucket state: `正常` when data exists and is up, `断线` when data exists and is down, and `无数据` when no probe falls in that interval.
- The tooltip is positioned above the hover point, does not alter layout, has no pointer events, and remains visible above neighboring rows.
- The existing whole-row latest-sampling tooltip is removed.

## Verification

- Add server tests that assert bucket start/end timestamps are contiguous and correctly bound the requested range.
- Add client unit tests that cover mapping horizontal offsets to the first, middle, and final bucket plus interval/state tooltip formatting.
- Manually check domestic and international bars across at least two selected ranges, including a no-data bucket.
