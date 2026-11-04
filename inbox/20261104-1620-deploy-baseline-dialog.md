---
title: Deploy the rebuilt "Set New Baseline" dialog
from: scanin-handbook
to: scanin-web-platform
kind: handoff
status: open
created: 2026-11-04T16:20
---

Context: the baseline dialog wrote only reset baselines with a 24h-median initial, so clicking a chart point never produced the expected "this point becomes zero, series stays continuous" result. Nathan's resets on Neviim 6 and Mercantil 2 cut the MA window and removed smoothed points. The dialog was rebuilt to expose both behaviors honestly.

Assignment: the changes are already implemented in `scanin-web-platform` (uncommitted or committed — check `git status`). Review, then build and deploy hosting as usual: Node 12 (`nvm use 12`), `ng build --prod`, `./deploy.sh` (firebase hosting `new-scanin-ui`). No Firestore/data writes are involved; this is a pure UI change.

Files changed:
- `src/app/services/baseline.service.ts` — `iron` reason added to `BASELINE_REASONS` and the `BaselineEvent` union (server already accepts it).
- `src/app/dialogs/set-baseline-dialog/set-baseline-dialog.component.{ts,html,scss}` — new "New zero =" choice (clicked point = exact zero / 24h median / manual), reset vs continuity warnings, clicked-point preview, and a post-save result card (initial values + source, notices resolved, recompute stats: samples, MA gained/lost, suspects flagged/cleared).
- `src/app/pages/site/sensor-cmp/sensor-chart-main/context-menu/context-menu.component.ts` — passes the clicked point (axisKey, rawValue, rawSample) into the dialog.
- `src/app/pages/site/sensor-cmp/sensor-chart-main/type-specific/prism-chart/prism-chart.component.ts` and `type-specific/default-chart/default-chart.component.ts` — `selectedPoint` now carries `axisKey`, `rawValue`, `rawSample`; type declarations updated.

Already verified: `tsc -p tsconfig.app.json --noEmit` clean; `ng build --prod` succeeds (only pre-existing budget warnings).

Done when: hosting is live; right-click a point on a prism chart → "Set new baseline" shows the iron option as default and the clicked-point zero preview; saving shows the result card. Report back with a `kind: feedback` message naming the deployed revision/time. Do not run any data fixes — the damaged baselines on Neviim 6 / Mercantil 2 are a separate, later task (deleteBaseline + iron).
