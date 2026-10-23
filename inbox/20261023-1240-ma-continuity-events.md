---
title: MA must not restart at "continuity" baseline events (ironing) — window spans them, each sample adjusted by its own baseline
from: scanin-handbook
to: scanin-svc-firebase-functions
kind: task
status: open
created: 2026-10-23T12:40
---
Context: on 20.10 the DeVinci prisms (`hmPh7Hg2fjTc9GyNRDYO`, 98 active) were ironed. Each prism got a clean set of baseline events: one "start of data" zero, plus one event per jump that shifts the zero by exactly the jump size (`ops/src/oneoff/2026-10-20-devinci-flatten.ts`). These events keep the series **continuous**.

But the MA treats every baseline event as a hard reset. `filterWindow(…, baselineTime)` drops the samples before the event, so after each event the 48 h window is empty until it refills (min-n / quarter coverage).

Result, read-only check 23.10 (`ops/src/analysis/smooth-daily.ts`): on the days of the 10 station-wide ironing moments only **27–71 %** of DeVinci samples have `smooth` (08–09.10, 14.10, 16.10, 19.10). Every other day is 93–100 %. These are MA holes in the UI and in reports (Nathan's REP141 is due today; the report currently bridges them with `connectGaps`).

**Marking:** the handbook session sets `continuity: true` on every DeVinci event with note `flatten: step …` (the "start of data" event stays a normal reset), and all future ironing events will carry it. Please also treat `reason: "iron"` as continuity, and add `"iron"` to `BASELINE_REASONS`.

Assignment:
1. **Smoothing window:** a baseline event with `continuity: true` does **not** cut the window. The window keeps samples across it, and **each window sample is adjusted with the baseline in force at its own time** (`baselineAt(sample.time)`), not with the window's latest baseline. Reset events (no `continuity`) behave exactly as today. Apply it to:
   - the live path (`checkThresholds`);
   - `recomputeSmoothingCore` (main pass + your new re-seed pre-scan);
   - `smoothing.ts` (`filterWindow` / `computeSmooth` take per-sample initials, or the caller pre-adjusts).
2. **`ref` / suspect check across a continuity event:** compare on the adjusted values. They're continuous by construction, so no re-seed or suspect flag should be triggered by the event itself.
3. **Emulator tests:**
   - a sensor with a +10 mm step ironed by a continuity event → smooth continuous, no MA gap at the event, `wouldChange = 0` on a second run;
   - a normal reset event still resets the window;
   - mixed events.
4. **Deploy (Hillel approved the fix; this ships your ref-lock commits too):** push, then deploy `checkThresholds`, `recomputeSmoothing`, `setBaseline`, `deleteBaseline`, `restoreBaseline`. That's fine: the code deploy alone doesn't recompute history. **Don't run any fleet `--apply`** (the giant steps on other sites still wait; see `20261020-2000-functions-hold.md`).
5. **Recompute DeVinci only:** `node scripts/recompute-smoothing.js --project=hmPh7Hg2fjTc9GyNRDYO --days=all --type=prism --apply`. Check with `ops/src/analysis/smooth-daily.ts hmPh7Hg2fjTc9GyNRDYO --from=2026-09-17`: the ironing days should be ≥ 90 % like the others. The days after the real outage (30.09–01.10) and its first window will stay lower; that's expected.

Done when: deployed, DeVinci recomputed, and a `kind: feedback` message to `user` with the commits, the test results and the before/after table of `smooth-daily`.
