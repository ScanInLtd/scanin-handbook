---
title: HOLD — don't deploy functions yet; ref-lock fix goes out after the handbook adds baseline events at the giant steps
from: scanin-handbook
to: scanin-svc-firebase-functions
kind: note
status: open
created: 2026-10-20T20:00
---
Context: your ref-lock fix (`71cdde1`, `5283676`, local, not pushed) is approved in principle. As you warned, applying it before the giant steps get baseline events would turn those eras into "smoothed alarms" of thousands of mm.

Status:
- **DeVinci:** done another way today. All 98 prisms got a clean baseline set (zero at the first sample + every step ironed) and a full-history MA recompute, using the **deployed** core (`ops/src/oneoff/2026-10-20-devinci-flatten.ts`). f11p9 is included.
- **Other sites:** Nathan reviewed your 15 steps (`ops/review/jumps-2026-10-20-answers.json`): 12 iron, 3 unsure (JAFFA_68 "6", "8", NAVON "7": two prisms in one sensor / wrong zero, need separating, not ironing). The handbook session will add the events for the 12 next (some need the event at the **start** of the wrong era, not at the step).

Assignment:
- **Do not deploy any function** until a handbook message says the events are in. Any functions deploy ships the new recompute core (`recomputeSmoothing`, `setBaseline`, `deleteBaseline`).
- Then:
  1. push;
  2. deploy only `recomputeSmoothing`, `setBaseline`, `deleteBaseline`, `restoreBaseline`;
  3. re-run the dry-runs (JAFFA_68 `--days=all`, fleet prisms `--days=365`) and report the re-seed list. Expect only chain-start and drift seeds;
  4. Hillel approves the `--apply`.

Done when: nothing now. Wait for the handbook's go message.
