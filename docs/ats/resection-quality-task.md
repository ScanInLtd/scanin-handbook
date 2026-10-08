# Task: resection quality & wrong-target detection (ATS monitoring app)

_Repo: `scanin-fw-ats-monitoring` · Written 2026-10-08 (Hillel + handbook) · Status: TODO_
_Reply with the implementation summary in `../signal-and-alerts/feedbacks/ats-resection-quality.md`._

## Background — what happened at DeVinci (station 5, `DeVinci-1`)

Every cycle for days, the resection "PASSED" with **RMS ≈ 23.4 mm**. Per-reference residuals (event log, `engine.cycle`):

```
Cycle 211–214: R1=11.1mm  R2=12.1mm  R3=12.1mm  R4=45.9mm  R5=14.7mm  → RMS 23.4 mm
```

- **R4 is ~46 mm off, stable to 0.1 mm** → R4 physically moved or its stored site coordinates are wrong (or its prism/constant changed). Not a random mis-lock.
- The other references read 11–15 mm only because R4 pulls the fit. Without R4 they should be a few mm.
- The cloud prism thresholds are 4/6 mm, so a 23 mm station error is larger than the movement we monitor. Every monitored point inherits it.
- Separately (2026-10-06..08), monitored points were measured on the **wrong prism**: in one cycle f11p9 and f11p11 returned each other's position (ΔY +7522 / −7526 mm, ΔZ −1533 / +1535). Similar on f11p8, f11p12, f8p1 (station 5) and f4p1, f11p3 (station 2). The cloud blocks these as "suspect", but they should be caught at the station.

What the app does today (verified in code):
- **Re-teach of an existing reference** (`teach_point`, no coordinates) refreshes the aim angle only. Site coordinates are kept on purpose. It doesn't fix a moved reference.
- **Manual resection** recomputes aim angles for all points. It doesn't change site coordinates.
- **Re-founding all references** creates a new site frame and breaks every monitored point's baseline. Never do it on a running site.
- The resection step is reported as `passed` regardless of RMS. Per-reference residuals only reach the event log.

Field action taken on 2026-10-08: R4 deactivated, cycle resolved from R1, R2, R3, R5. The cloud sets an `ats-setup` baseline for all station-5 points at the first cycle without R4.

## Requirements

### 1. Per-reference residuals visible in the UI
- Add `residuals_mm: {ref_id: value}` (already computed: `transform_residuals`) to the `resection` `step.finished` progress event, and store them with the cycle (`save_transform` / cycle record).
- **Resection card:** the RMS plus a small table of references with their residuals. Colour each residual: green < 5 mm, orange 5–10, red > 10 or more than 3× the median.
- **References screen:** residual history per reference (last N cycles), so a reference that drifts or jumps stands out.
- Include `rms_mm` and `residuals_mm` in the cycle summary published to the cloud (`ats-runs` / cycle message), so we can watch station quality from the handbook and the watchdog.

### 2. RMS thresholds: no more "PASSED" at 23 mm
- Configurable per site: `rms_warn_mm` (default 5) and `rms_fail_mm` (default 10).
- **RMS > warn:** the step is `passed` but flagged `warning`. The UI shows it in orange, and the event log has a WARNING with the residuals.
- **RMS > fail:** the step is `suspect`. Monitored results of that cycle are still measured and stored, but published with `qc.flag = "bad-resection"` (plus `rms_mm`), so the cloud marks them suspect and they never reach clients as movement. The UI shows the cycle in red, with a clear message ("check reference R4 (46 mm)").
- Document the cloud contract in `PROTOCOL` / the bridge docs (field name, values). The bridge and functions will read `qc.flag`.

### 3. Automatic exclusion of an outlier reference
- After solving: if ≥4 references were used, find the reference with the largest residual. If that residual is > 3× the median of the others **and** > 10 mm, drop it and solve again with the rest (≥3).
- Keep the re-solve only if the new RMS is clearly better (for example < half). Otherwise keep the original and flag it.
- Log: `Cycle N: excluded R4 (45.9 mm, median 12.1) → RMS 23.4 → 2.1 mm`. Show "R4 excluded this cycle" on the Resection card. Count it in the cycle summary (`excluded_refs`).
- Never auto-exclude when that would leave fewer than 3 references. Never exclude more than one per cycle.
- If the same reference is excluded in N consecutive cycles (default 3), raise a station warning: "R4 consistently off, check it on site".

### 4. "Re-found reference from current resection"
For a reference that moved (or was replaced) on a running site, without breaking the frame:
- Precondition: a fresh resection from the **other** references with RMS < warn.
- Measure the reference (EDM, 2 faces if the schedule uses 2 faces), apply the current instrument→site transform, and store the result as its **new site coordinates**. Keep the old coordinates in history: `reference_coord_history` with time, old, new, reason, and the RMS of the transform used.
- UI: on the references screen, the action "Re-found from current resection", with a confirm dialog showing old vs new coordinates and the size of the change.
- Log it in the event log. Re-enable the reference after it's re-founded.
- Use case now: bring R4 back as the 5th reference after its cause is understood on site.

### 5. Wrong-target detection for monitored points (prism swaps)
- After each monitored measurement, compare the 3D result (site frame) with the point's expected position (last good / baseline coordinates).
- If the deviation is > tolerance (default 50 mm, configurable per point): re-measure once with a narrowed ATR search window / PowerSearch off.
- If it's still off **and** the result is within tolerance of **another** point in the site list: set `qc.flag = "wrong-target"` with `matchedPoint`, and don't publish it as this point's movement (publish with the flag, so the cloud keeps the audit trail). Log it in the event log.
- If several points fail in one cycle: a station-level warning.
- This complements the existing in-cycle re-measure / suspect hold (`movement-resection-guide.md`, "Suspect-result protection"). It adds identification of *which* prism was hit.

### 6. The cycle screen must show what happened to each point
Cycle #252 (2026-10-08): "MONITORING · PASSED — A2 · displacement 1381.872 mm" in green, although that's a wrong-target / suspect result. A user reading the screen must see the problem without opening logs.
- Each monitored card shows its state with colour, never plain "PASSED" for a non-normal result:
  - green: normal (displacement under the point's warn level);
  - orange: displacement above warn, or re-measured once in the cycle;
  - red: suspect (held, not published), wrong-target (`matchedPoint` shown: "probably hit A4"), or above alarm.
  - Show the reason in one line, e.g. "suspect: 1382 mm vs last 0.4 mm — re-measured, held for confirmation".
- The references cards and the resection card: a failed reference (R5 timeout) shows its cause in plain words ("ATR didn't find the prism — line of sight / prism blocked?"). When the resection used **only 3 references**, show an orange note "no redundancy: a bad reference can't be detected".
- At the end of the cycle: a summary line (n ok / n suspect / n wrong-target / n failed, RMS, references used and excluded), the same as what's published to the cloud.

### 7. Clear names and explanations for point actions
The operator sees Teach / Re-aim / Measure / Go to / Resection, and it isn't clear what each changes. Rename and explain (tooltip + one line under the button):
| Today | Proposed label | What it changes |
|---|---|---|
| Teach (new reference) | **Create reference here** | measures the point and sets its coordinates (only in the original setup) |
| Teach / Re-aim (existing point) | **Fix aim (keep coordinates)** | aim angle only; coordinates and baseline unchanged |
| Go to | **Point the instrument here** | nothing is saved |
| Resection → Measure | **Measure reference for resection** | nothing is saved until "Solve" |
| Resection | **Solve station position** | updates every point's aim angle; coordinates unchanged |
| (new, §4) | **Re-found reference from current resection** | the reference's coordinates (history kept) |
- A short "Which action do I need?" help panel: instrument moved → Solve station position; a point keeps hitting the wrong prism → Fix aim; a reference moved → Re-found reference.

## Verification
- Unit tests for `solve_transform` with an injected outlier: §3 excludes it, the RMS drops, and only one reference is excluded.
- A replay of the DeVinci cycles 211–214 (observations from the station DB) shows R4 excluded and the RMS around a few mm.
- A simulated swap (two points' observations exchanged) shows both flagged `wrong-target` with the right `matchedPoint`.
- UI screenshots: the Resection card with residuals (one red), the references screen with history, the re-found dialog, a cycle screen with a suspect / wrong-target point in red, and the renamed point actions.

## Deploy
- Build and deploy on the station PCs per `docs/fresh-pc-install.md` / the usual procedure. **After Hillel approves.**
- Deploy one station first (DeVinci station 5), watch 2–3 cycles, then the rest.
- Tell the handbook when `qc.flag` is live, so the bridge and functions start reading it.
