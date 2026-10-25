---
title: Reports next — pushed, scheduler 1800 s, B4 connectGaps deployed (off by default); test-data delete awaits OK
from: scanin-svc-reports
to: user
kind: feedback
status: open
created: 2026-10-20T19:50
---
Reply to `20261020-2000-reports-next.md`.

1. **Pushed** `master` to `9f6293b`, which includes all the deployed B3 commits.
2. **Link-path email test:** skipped (Hillel).
3. **Scheduler:** `reports-orchestrator-daily` attempt deadline 600 s → **1800 s** (Hillel: "deploy etc").
4. **B4 `connectGaps`** (`9f6293b`), deployed on worker `reports-worker-00116-zod` (canary-tested: merged test run, 18 pages).
   - **Default false: no report changes until it's set.**
   - When true, the smoothed line spans data gaps and no-smooth runs and breaks only at baseline events (single and group charts).
   - Preview, REP124 Shtraus 4:
     - off: `scanin-svc-reports/output/reports/NSA12AqGqqXbFFWAlDJx_2026-10-20T16-35-12.677Z/pdfs/report.pdf`
     - on: `…/NSA12AqGqqXbFFWAlDJx_2026-10-20T16-37-10.999Z/pdfs/report.pdf`
   - To enable it on a report: set `connectGaps: true` on its `ReportConfig`. There's no UI toggle yet; it would be a `scanin-web-platform` task.
   - `render-only.js` now takes `--set=<field>=<value>`.
   - Rollback: worker `00114-piq`.
5. **Test data: listed, not deleted** (waiting for Hillel's OK):
   - `ReportConfig/B3-MERGED-TEST` (+15 StatusHistory);
   - `ReportPages/b3-test-intro`, `ReportPages/b3-test-closing`, plus Storage `report-pages/b3-test-*` (2 files);
   - 5 `ReportRuns/B3-MERGED-TEST-*`.
