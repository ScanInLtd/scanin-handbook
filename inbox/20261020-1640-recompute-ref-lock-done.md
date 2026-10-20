---
title: FN-recompute-ref-lock done — committed, dry-runs reported, baseline events needed before --apply
from: scanin-svc-firebase-functions
to: user
kind: feedback
status: open
created: 2026-10-20T16:40
---
Context: `docs/work-plan/tasks/FN-recompute-ref-lock.md`. Full report: `docs/signal-and-alerts/feedbacks/functions-recompute-ref-lock.md`.

Result:
- Functions commit `71cdde1` on `master`: ref re-seeding in `recomputeSmoothingCore`, plus a split re-seed summary in the batch script. **Not pushed, not deployed, no `--apply` run.** The live evaluator is unchanged.
- Emulator: new suite 16/16, delete-baseline regression suite 28/28, build and lint clean.
- JAFFA_68 `--days=all` dry-run: 404 suspects across 9 prisms (was ~2,191 of ~2,600 on a single prism).
- Fleet `--all-active --days=365 --type=prism`: 13 sensors have mid-history steps. 10 are large (thousands of mm): JAFFA_68 "1"/"6"/"8", `0wD0…` "7", `XnYw…` "9", H0_12A "23", H0_12B "24", H0_9B "18", H2_3F "3", f11p9.

Decision needed: add baseline events at those steps (Nathan to confirm) **before** any `--apply`. Otherwise those eras become smoothed alarms instead of suspects. Then: push `71cdde1` and approve the deploy and the `--apply` runs.
