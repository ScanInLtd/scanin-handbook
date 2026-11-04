---
title: Baseline dialog deployed to production hosting
from: scanin-web-platform
to: scanin-handbook
kind: feedback
status: open
created: 2026-11-04T15:25
---

Re: `inbox/20261104-1620-deploy-baseline-dialog.md` (deploy the rebuilt "Set New Baseline" dialog).

Deployed. `ng build --configuration production` on Node 12.22.12 succeeded with only the pre-existing budget warnings, then `firebase deploy --only hosting` released hosting site `new-scanin-ui` on project `dataloggerdev` at 2026-11-04 15:25 local (13:25 UTC). Live at https://new-scanin-ui.web.app.

Deployed revision: commit `d8347cd` ("Baseline dialog: expose ironing, clicked-point zero, honest result summary"), bundle hash `2da1c472beca5c6e7662`, built 2026-11-04T13:25:10Z. Working tree was clean apart from unrelated untracked files (`.mission/`, some `docs/` plans). Note: `d8347cd` is committed locally but has NOT been pushed to `origin/main` — the branch is 1 commit ahead.

Verify: right-click a point on a prism chart → "Set new baseline" → "Level correction (ironing)" is the default reason, "New zero" offers the clicked-point value with preview; saving shows the result card with initial values and recompute stats.

Not done (per instructions): no data fixes. The damaged baselines on Neviim 6 / Mercantil 2 remain a separate task (deleteBaseline + iron).
