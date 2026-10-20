---
title: Raw line must follow baseline events (piecewise) — 3 uncommitted files in your tree, please verify + commit + deploy with B3
from: scanin-handbook
to: scanin-web-platform
kind: handoff
status: open
created: 2026-10-20T19:15
---
Context: today the DeVinci prisms were "ironed" with baseline events (`ops/src/oneoff/2026-10-20-devinci-flatten.ts`). The MA line (`smooth`, adjusted server-side per baseline event) is flat now, but the faint **raw** line ("גולמי") still shows the old jumps, because the UI adjusts raw with ONE constant: the current `initial-value`. Hillel saw it on f13p6 (raw drops to −3 between 09.10 and 14.10; the MA is flat).

**Also, an apology from the handbook session:** at 19:02 I killed an `ng build --configuration production` in your repo, thinking it was mine. It was yours. Please re-run your build before deploying B3 (`84f6142`).

**The change. Already in your working tree, uncommitted, written by the handbook session.** `tsc -p tsconfig.app.json --noEmit` (Node 12) passes. No `ng build` was run.
- `src/app/shared/baseline-at.ts` (new): `initialAt(events, time, fallback)` uses the `initial` of the latest baseline event with `time ≤ sample.time`, else `fallback` (the current initial-value mirror). This is the same rule as functions `recomputeSmoothing.baselineAt`.
- `sensor-chart-main.component.ts`: `toAdjustedPoint` uses `initialAt(this.baselineEvents, row.time, this.initialValues)`, and `ngOnChanges` rebuilds adjusted data when `baselineEvents` changes (events load async after the data).
- `prism-chart.component.ts`: `getInitialValueForAxis(axis, time)` is piecewise, `getAdjustedRawValue` passes `d.time` (E/N/H and TwoD = hypot(E−E0, N−N0)), and a `baselineEvents` change triggers a redraw, like `initialValues`.

Assignment:
1. Review the 3 files, then `ng build --configuration production` (Node 12).
2. Commit them **separately** from B3, e.g. `fix(sensor-chart): raw line adjusted per baseline event (piecewise), matches the MA`.
3. Deploy hosting together with B3 (`./deploy.sh`). B3 hosting + rules deploy is already approved by Hillel.
4. Check on DeVinci f13p6 (`/s/Hrm0tH08Pto0UVJLzVaW`) and f4p11 (`/s/77eMf4CHjLSYUHkuscLK`): with Points on, the raw points sit around the MA line across 08.10–16.10, with no −3…−15 mm steps. "Unadjusted" still shows true raw.

Done when: live, both sensors checked. Reply with a `kind: feedback` message to `user` (commit hashes, bundle hash, and anything that didn't fit, e.g. other raw paths such as the compare page or the group view that still use a single initial).
