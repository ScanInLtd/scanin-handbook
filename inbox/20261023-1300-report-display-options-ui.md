---
title: Report editor — toggles for the new chart display options (connectGaps, markers, UI scale)
from: scanin-handbook
to: scanin-web-platform
kind: task
status: open
created: 2026-10-23T13:00
---
Context: the reports worker now supports 5 per-report chart options (`scanin-svc-reports` `9f6293b`, `a8ab57e`, `fe0a7e9`, live on `reports-worker-00120-yux`). Today they can only be set by script; they're set on REP141 (DeVinci) only. Hillel wants them in the report editor for every sensor / group / merged report. This goes into your queue after the current work (restyle + `20261020-2000-web-platform-queue.md`), unless Hillel says otherwise.

| Field on `ReportConfig` | Type | Missing / default | Meaning (Hebrew label suggestion) |
|---|---|---|---|
| `connectGaps` | bool | false | Connect the line across data gaps and MA-less stretches ("חבר קו מעל פערים בנתונים") |
| `showBaselineMarkers` | bool | true | Draw a vertical line per baseline event; false also stops breaking the line there ("הצג אירועי קו בסיס") |
| `showAlertMarkers` | bool | true | Draw alert markers (▲ ●); false also keeps them out of the y-range ("הצג סימוני התראות") |
| `useUiScale` | bool | false | Y-axis = the sensor's `uiScale` (group: the union of members) ("סקאלה כמו בממשק") |
| `forceUiScale` | bool | true | Only when `useUiScale`: exactly that range, values outside clipped at the edge; false = grow to fit the data ("קבע סקאלה גם אם יש ערכים מחוץ לטווח") |

Assignment:
1. In the report editor (sensor / group / merged; at merged level they apply to all parts), add a "תצוגת גרפים" section with these 5 toggles (`mat-slide-toggle`, as for the existing `showRaw` / `zeroGroupSeries`). `forceUiScale` is shown / enabled only when `useUiScale` is on.
2. **Defaults when the field is missing must match the table**, so existing reports don't change when saved. Don't write the field unless the user touches it (or write the default explicitly; just don't flip behavior).
3. Short help text per toggle (tooltip), especially: "a sensor without uiScale falls back to the automatic scale".
4. Check: open REP141 (`ReportConfig/Nn5D8EIN9shaaSvhCqPO`). The toggles show its saved values (connectGaps on, both markers off, UI scale on, force on by default). Save without changes leaves the doc unchanged.

Rules: build (Node 12) before deploy; hosting deploy approved once the REP141 check passes.

Done when: deployed, and a `kind: feedback` message to `user` with the commit, the bundle hash and a screenshot or description of the section.
