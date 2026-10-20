# Task A3 — Delete a baseline event (functions + UI)

_From: Hillel, 2026-10-20. Plan: [`../2026-10-20-reports-and-data.md`](../2026-10-20-reports-and-data.md) §3 A3. Two sections, one per repo: functions first (the callable), then UI._

## Why

Nathan prepares client reports. Some sensors have wrong baseline events: a bad re-baseline, one set at the wrong time, or a station-wide `ats-rebaseline` that shouldn't have applied to a point. Each wrong event makes the chart and the report jump. Today you can only **add** a baseline (`setBaseline`); there's no way to remove one. Nathan needs to delete a wrong event himself, from the sensor page, and see the chart fixed right away.

## How baselines work today (both teams read this)

- Events live in `work-sensors/{id}/baseline-events/{autoId}`: `{ time, reason, initial: {<axis>: number}, by, note, createdAt }`. Reasons: `replaced | moved | rebaseline | mapping-fix | ats-setup | migration`.
- **Adjusted value** of a sample = raw − `initial` of the latest event with `time ≤ sample.time`. Samples **before the first event** use the sensor's current `initial-value` (`recomputeSmoothing.ts`, `baselineAt`).
- `work-sensors/{id}.initial-value` **mirrors the latest event** (read by legacy code and the live evaluator).
- `setBaseline` (`src/setBaseline.ts`, `applyBaseline`):
  1. writes the event;
  2. mirrors `initial-value`;
  3. resets `status.axes` to ok and `alert_state.axes` to `{}`;
  4. resolves open data-integrity notices;
  5. runs `recomputeSmoothingCore({ sensorId, fromTime: eventTime, apply: true })`, which rewrites `smooth` / `eval` from that time.
- UI: `services/baseline.service.ts` (`setBaseline`, `listBaselineEvents`), `dialogs/set-baseline-dialog`, chart markers (`baselineMarkers` in `prism-chart.component.ts`, `eventMarkerTooltipLabel` in `default-chart.component.ts`), sidebar `initial-value` component.

---

## Section 1 — `scanin-svc-firebase-functions`: `deleteBaseline` callable

### Behavior
`deleteBaseline({ sensorId, eventId, note? })`, onCall v2. Same auth as `setBaseline` (admin / `isAdmin`), same region, memory and timeout (512 MiB / 300 s).

1. **Load** the sensor and all its baseline events (ordered by `time`).
2. **Refuse** with `failed-precondition` and a clear message when:
   - the event doesn't exist;
   - it's the **earliest** event of the sensor. It holds the original zero, and deleting it would re-zero all early history to the current `initial-value`. This covers most `migration` / first `ats-setup` events;
   - it's the **only** event.
3. **Archive, then delete** (one batch):
   - copy the event to `work-sensors/{id}/baseline-events-deleted/{eventId}` with `deletedAt` (server timestamp), `deletedBy` (uid or email), `deleteNote`;
   - delete it from `baseline-events`.
   This keeps an audit trail and makes undo possible.
4. **Re-mirror** `initial-value` = `initial` of the latest **remaining** event (it only changes if the deleted event was the latest).
5. **Reset** `status.axes` to ok and `alert_state.axes` to `{}`, the same as `setBaseline`, since the zero changed. Don't touch notices.
6. **Recompute:** `recomputeSmoothingCore({ sensorId, fromTime: deletedEvent.time, apply: true })`. A recompute failure must not undo the delete; report it in the result (same pattern as `setBaseline`).
7. **Log** one line (sensor, event time, reason, initial, by, recompute stats) and **return** `{ deleted: {eventId, time, reason}, initialValue, recompute }`.

### Also
- `restoreBaseline({ sensorId, eventId })` (admin): move the doc back from `baseline-events-deleted`, then steps 4–6 using the restored event's time. Small and symmetrical; it's the undo.
- Export both in `src/index.ts`.
- Emulator tests:
  - deleting a middle event → samples between it and the next event get the previous event's baseline; `smooth` matches a fresh recompute (`wouldChange = 0`);
  - deleting the latest event → `initial-value` mirrors the new latest;
  - earliest/only event → refused;
  - restore → identical to before the delete.
- Deploy: `firebase deploy --only functions:deleteBaseline,functions:restoreBaseline` (no other functions change). Write the feedback in the handbook (`docs/signal-and-alerts/feedbacks/`).

### Not in scope (later, maybe)
Bulk delete: e.g. "delete the station-wide `ats-rebaseline` of 16.10 01:15 on all ATS-5 points". Design the core so a bulk wrapper can loop over it.

---

## Section 2 — `scanin-web-platform`: delete from the sensor page

Depends on Section 1 being deployed.

### Where
1. **Chart marker** (prism chart and default chart): clicking a baseline marker opens a small popover with date, reason, who, note and the values, plus **"מחק בייסליין"** (admin only).
2. **Sidebar "Initial Value"** (`sidebar-elements/initial-value`): a **list of the sensor's baseline events** (newest first: date, reason, who, short values), each with a delete icon (admin only). This is the place to find events when the marker is hard to hit.

### Behavior
- **Earliest event:** delete disabled, with tooltip "הבייסליין הראשון של החיישן – לא ניתן למחוק".
- **Confirm dialog** (Hebrew, RTL), saying what will happen in plain words:
  "יימחק הבייסליין מ-‹date› (‹reason›). מ-‹date› והלאה הגרף יחושב מחדש לפי הבייסליין הקודם מ-‹prevDate›." Plus an optional note field. Buttons: מחק / ביטול.
- **Call `deleteBaseline`**, with a spinner (recompute can take tens of seconds on long histories).
- **On success:**
  - **re-fetch the chart's current range** and the events list, so the chart updates immediately with no manual Fetch (related to bug C1, "delete point needs Fetch");
  - toast: "הבייסליין נמחק · ‹n› נקודות חושבו מחדש" + **"בטל"** (undo, which calls `restoreBaseline`).
- **On error:** show the server message (e.g. the earliest-event refusal).
- Add `deleteBaseline` / `restoreBaseline` to `baseline.service.ts`, next to `setBaseline`.

### Acceptance (UI + functions together)
- On a test sensor (project `בדיקות משרד`): add two baselines, delete the middle one from the marker. The chart from that date moves back to the previous baseline without a manual Fetch; the event disappears from the sidebar list; undo brings it back.
- The earliest event can't be deleted (button disabled, server refuses too).
- Non-admins see no delete actions.
- Then on one real DeVinci sensor, with Hillel watching.
