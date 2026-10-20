# Task A4 — Iron the DeVinci prism jumps (data check + dry-run plan)

_From: Hillel / Nathan, 2026-10-20. Plan: [`../2026-10-20-reports-and-data.md`](../2026-10-20-reports-and-data.md) §3 A2/A4. Repo: `scanin-handbook` (ops). **Read-only + dry-run. Do not write to production.**_

## Why
Dozens of DeVinci prisms (station ATS-5) show **temporary** jumps: the level steps away, stays shifted for days, then comes back or gets re-zeroed. Example: `f6p6` (`y25VvYinODz3kK9K2r6H`), X axis. Raw steps about −14 mm on **2026-10-09 ~08:00**, stays there, and the station-wide `ats-rebaseline` on **2026-10-16 01:15** brings it back to 0. The 48h line sits at −12…−14 mm for a week, and that's what clients see in reports. Nathan needs these flattened before he sends reports.

## How ironing works (no new code needed)
- A temporary jump is covered by **a baseline event at the jump's start**: `applyBaseline({ sensorId, time: <jump start>, reason: 'rebaseline', note: 'iron: …' })`.
  - When `initial` is omitted, the server sets the new zero to the **median of raw values in the 24h after `time`**, i.e. the shifted level, so the jump window becomes ≈ 0.
  - It then **recomputes `smooth`/`eval` from that time** automatically (`recomputeSmoothingCore`).
  - Raw data is never changed. The event can be deleted later (`deleteBaseline`, deployed today).
- **If the jump ends without an existing event** (no `ats-rebaseline` / `ats-setup` at its end), a second event at the jump's end is needed, with the zero of the era before the jump.
- **Precedent:** `ops/src/oneoff/2026-10-06-devinci-baselines.ts` (plan, dry-run) + `2026-10-06-devinci-baselines-apply.js` (apply via the functions `lib/` cores `applyBaseline` / `recomputeSmoothingCore`). Follow the same structure.

## What to do
1. **Inventory** every active prism of project `hmPh7Hg2fjTc9GyNRDYO` (מגדל דה וינצי דרום), E/N/H axes, from **2026-08-15 to now**:
   - existing baseline events (time, reason, initial);
   - **steps**: persistent level changes (e.g. > 3 mm, holding ≥ 2 runs), from raw minus the baseline in force. Reuse `ops/src/analysis/level-shifts.ts` / `common-mode.ts` / `level-by-month.ts` logic as needed;
   - for each step: start time, end time (back to the old level, or an existing baseline event, or still open), size per axis, and which station (ATS-5 / station 2).
2. **Group** the steps by time: how many prisms jump together, i.e. a station-wide frame event vs. a single prism. List the groups (e.g. "10-09 08:00, 31 prisms, median −13.8 mm").
3. **Classify** each step:
   - **temporary**: it returns, or ends in an existing re-zero event → iron;
   - **permanent**: a new level that stays and isn't re-zeroed; the prism may have really moved, or was remounted → **list it for Nathan, don't iron automatically**.
4. **Plan** (oneoff `ops/src/oneoff/2026-10-20-devinci-iron.ts`, **dry-run only**): per sensor, the events to add (time, reason `rebaseline`, note `iron: <group>`, expected `initial` = median of the 24h after), and whether an end-of-jump event is also needed.
   - **Simulate** the adjusted series with the planned events (raw − baseline in force) and check that the jump window ends within ±2 mm of the levels before and after, on every axis.
   - Write the plan JSON to `ops/out/` and an apply script modeled on the 10-06 one, **not run**.
5. **Report** to Hillel: `docs/work-plan/feedbacks/A4-devinci-iron.md`, containing:
   - the groups table;
   - per-sensor plan rows;
   - the permanent steps for Nathan;
   - before/after numbers (max jump in the window, old vs simulated);
   - optionally a small HTML with before/after mini-charts for 5 representative prisms.

## Rules
- **Read-only.** No `applyBaseline`, no `recompute --apply`, no Firestore writes. Hillel approves, then the apply script runs.
- Exclude `suspect` ingestion samples (`run-common-mode`, `implausible-jump`) from the medians.
- Don't touch the earliest baseline event of any sensor.
- Auth: run inside `~/dev/clients/scanin` (direnv) or via `./go.sh run …`. See the handbook `AGENTS.md`.
