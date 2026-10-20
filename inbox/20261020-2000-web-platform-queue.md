---
title: Queue after the reports-page restyle — push, group view piecewise raw, resize images on upload
from: scanin-handbook
to: scanin-web-platform
kind: task
status: open
created: 2026-10-20T20:00
---
Context: follow-ups from today (`docs/work-plan/2026-10-20-reports-and-data.md`, status board). Do them **after** the reports-page restyle Hillel just asked for, in this order.

Assignment:
1. **Push** `main`. 3 commits are live but only local: `84f6142`, `ad91b92`, `46af0ef` (plus the restyle when done).
2. **Group view: raw per baseline event.** `pages/sensor-groups/sensor-group-view.component.ts:533` still subtracts one `initial-value`, so the group charts of the ironed DeVinci prisms still show the old steps in raw.
   - Load each sensor's `baseline-events` (`baselineService.listBaselineEvents`).
   - Adjust with `initialAt(events, row.time, sensor.initialValues)` from `src/app/shared/baseline-at.ts`, the same as `sensor-chart-main` / `prism-chart`.
   - Then check `charts/line-chart/line-chart.component.ts` (legacy / compare): if it plots adjusted raw, apply the same rule.
3. **Resize maps and covers at upload (B5).** Section maps and report covers are uploaded as 24 MP phone photos (5712×4284, 3–4 MB). They make the site / floor map pages slow, and they made a report PDF 55 MB. Before upload, downscale in the browser to max 2400 px on the long side, JPEG ~85% (canvas is enough, no new dependency). Apply this to every map / cover / report-page **image** upload. PDFs stay as they are. The existing big files will be shrunk by a separate handbook one-off.

Rules: verify with a production build (Node 12) before deploying. Hosting deploy is approved once items 2 and 3 are verified on f13p6 (`/s/Hrm0tH08Pto0UVJLzVaW`) in a group view and with one test upload.

Done when: pushed, deployed, and a `kind: feedback` message to `user` with the commits, the bundle hash and the checks.
