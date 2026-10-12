# Feedback: `scanin-fw-ats-monitoring` — resection quality (task `docs/ats/resection-quality-task.md`)

**Date:** 2026-10-08
**Repo:** [scanin-fw-ats-monitoring](https://github.com/ScanInLtd/scanin-fw-ats-monitoring), pushed to `main`: `fb8a3e3` (§6.1 re-found), `4d62cdb` (§0 diagnosis script). **Not deployed to any station.**
**Status:** §6.1 "Re-found reference from current resection" **implemented, tested on the simulator, committed. Waiting for Hillel's deploy approval** (DeVinci station first, via the usual `redeploy.bat`). §0 script committed, waiting for the station DB. §3–§8 not started.

---

## 1. §6.1 Re-found reference from current resection

### What it does

Two calls, so the operator sees exactly what will be stored before anything is written:

1. **Preview** — `POST /api/references/refound {point_id}`
   - Solves the station **now** from the **other enabled** references (taught aims, ATR, the schedule's faces and per-target timeout, same as a cycle).
   - Preconditions: **≥ 4** other references measured (3 only with `allow_three_refs: true`), resection **RMS < 5 mm**. Refused otherwise, with the residuals in the message.
   - Measures the reference (taught aim, or the aim predicted from its old coordinates if it has none), pushes the reading through the transform → new site coordinates.
   - Returns old / new / Δ (mm, per axis), RMS, refs used, residuals, failed refs, measured vs expected distance, and a `preview_id` (valid 15 min). **Writes nothing.**
2. **Apply** — `POST /api/references/refound {point_id, preview_id}` (+ `allow_three_refs` again if the preview used 3)
   - Stores **exactly the previewed** coordinates (no re-measure), plus the measured aim; **re-enables** the reference.
   - Refused if the reference's coordinates changed since the preview, or the preview expired / was already used.
   - New table `reference_coord_history` (time, old, new, `delta_mm`, `rms_used_mm`, `refs_used`, `reason`), written in the same transaction as the coordinate update.
   - Event log: `R4 re-founded: Δ=46.1 mm (from R1,R2,R3,R5, RMS 3.99 mm); re-enabled`. The preview and any refusal are logged too.
- `GET /api/references/history?point_id=R4` lists the history rows.
- A refound is rejected while a cycle is running; while a refound measures, it holds the instrument lock (a scheduled cycle waits for it).

### UI (only change)

Reference rows' **⋯** menu: **"Re-found from current resection"** → short "this will measure, nothing saved yet" dialog → measuring (toast) → if only 3 refs: a "no redundancy" confirm → result dialog with resection RMS, residuals, measured vs expected distance, **old vs new E/N/U and Δ mm** → **Save new coordinates** / Cancel. Internals: `api()` now also understands `{code, message}` error details; dialog text keeps line breaks.

### Files

| File | Change |
|---|---|
| `src/ats_monitoring/engine/refound.py` | new: `preview_refound`, `apply_refound`, `RefoundError` |
| `src/ats_monitoring/store/db.py` | `reference_coord_history` table, `refound_reference()` (atomic), `list_reference_coord_history()` |
| `src/ats_monitoring/api/monitoring.py` | `POST /api/references/refound`, `GET /api/references/history` |
| `src/ats_monitoring/api/static/index.html` | menu item + dialogs |
| `tests/test_refound.py` | new, `python3 -m unittest discover -s tests` |

The DB migration is automatic (`CREATE TABLE IF NOT EXISTS` at start-up); nothing else in the schema changes.

### Verification

- **Unit tests (7, all pass):** a moved reference (46 mm) → new coords == transform(measured) to 1e-9 m and == the true moved position; preview writes nothing; apply writes coords + history + event line, re-enables, and the next cycle solves from 5 refs at < 1 mm; 3 refs need confirmation (also when a 4th times out); a bad other reference → refused (`rms_too_high`); stale preview → refused; API flow incl. "a preview applies once".
- **Simulator, live server (HTTP):** REF4 stored 46 mm off and disabled, REF1/2/3/5 good → preview from REF1,REF2,REF3,REF5 at RMS 0.45 mm, Δ 46.3 mm, new coords within 0.3 mm of truth; apply → history row + event line; next cycle `ok`, 4–5 refs, RMS 0.36 mm. With a bogus reference among the others → refused at RMS 26 m with residuals listed.
- Pre-existing, unrelated: `scripts/sim_cycle_test.py` and `scripts/api_smoke_test.py` already fail on `HEAD` (they predate the async `/cycle/run` and outbox changes).

UI click-through on the simulator: pending Hillel's check (API flow verified over HTTP).

### For DeVinci R4 (when deployed)

1. Run a cycle (or check the last one) — R1, R2, R3, R5 must all measure; cycle 253 had RMS 3.99 mm, which passes the 5 mm gate, though not by much.
2. R4 ⋯ → Re-found → check Δ is about 46 mm and the measured distance is plausible (a wrong prism would show a big distance gap) → Save.
3. Next cycle should solve from 5 refs with RMS close to the 4-ref one, and R4's residual should be small.
4. Then set an `ats-setup` baseline in the cloud if needed: R4's new coordinates shift the frame slightly (it now takes part in the solve). The automatic `frame-change` event is §8, not in this release.

### Open points / not in this release

- R1/R2's residuals in cycle 253 (4.35 / 6.03 mm) are the largest; if R1 or R2 is the real problem, re-founding R4 from that frame bakes their error into R4. The §0 report (network check) should confirm R1–R3 + R5 are consistent before or right after.
- No §4 gates, no `frame-change` cloud event, no history UI yet.

---

## 2. §0 diagnosis (`scripts/diagnose_cycles.py`)

Written and tested on simulated DeVinci-like DBs (R4 46 mm off → flagged; 3-ref orientation error ≈ 0.18° → detected; swapped neighbouring prisms → wrong target with the right partner). Read-only (DB byte-identical after a run). `diagnose_cycles.bat` writes the report folder (report.md + CSVs) to the desktop. **Needs the station DB** (copy `ats_monitoring.db` + `-wal`, or run the .bat on the station) → then `docs/ats/devinci-diagnosis-2026-10-08.md`.

---

## 3. Release 2 — §4 quality gates, §5 wrong-target, §7.1 cycle screen (2026-10-08)

**Status:** implemented, unit-tested (24 tests) and run end-to-end on the simulator; committed to `main`, **not deployed**. Acceptance replay on the DeVinci DB **pending a copy of the station DB** (script ready, see 3.5).

### 3.1 Gates (`engine/quality.py`, per-site, defaults as in the task)

| Gate | Behaviour |
|---|---|
| Reference count | fewer than `min_refs_publish` (4) used → measured + stored, cycle **held**, `few-references`. Below 3 → failed, as before |
| RMS | > 5 mm → warning; > 10 mm → held, `bad-resection` |
| Outlier / leave-one-out | ≥ 5 refs (so ≥ 4 remain): max residual > 3× median and > 10 mm and RMS halves, **or** RMS > warn and < warn without it → that ref is excluded (one per cycle), logged, shown as *excluded* on its card. Same ref excluded 3 cycles running → warning "R4 consistently off — check it on site … re-found it" |
| Transform jump | frame change vs the previous solved cycle > 20 mgon / 10 mm **and** the raw reference observations moved < 10 mm (so the instrument didn't move) → held, `frame-jump`. If the raw observations moved → "instrument moved", not held |
| Orientation pattern | ≥ 4 points > 10 mm, displacement-vs-distance fit R² > 0.9 (robust: Theil–Sen start, outliers removed) → held, `orientation-error`, implied rotation in mgon/°; points off the line listed as "doesn't fit (wrong target?)" |

Held cycle: status `held`, `quality=bad`, every result marked `held`, **nothing enqueued to MQTT**, **no baselines established**, and held results never count as a prior candidate for suspect confirmation. Visible in the runs table (status + flags), the cycle detail, and exportable: `GET /api/cycles/{id}/export` (Markdown, link in the expanded run row). Settings: `GET/POST /api/qc-settings` (no UI yet).

### 3.2 Wrong-target detection (§5)

- After each monitored measurement: measured vs expected **distance** (frame-free) and 3D position vs baseline, tolerance 50 mm.
- If off → re-measure **at the expected position** with a **narrow ATR window (±0.5°)**; in that mode an ATR failure raises instead of measuring at the coarse aim. (Our code never uses PowerSearch; the normal FineAdjust window is ±5.2°, which is why ATR jumped between prisms ~3.4° apart on the A-column.)
  - re-measure lands where expected → first shot was another prism, **adopted** (`re-measured`, orange card: "first shot hit A3 …").
  - still off and (distance mismatch, or it sits on another point's position) → `wrong-target` + `matchedPoint`, not published (like suspects today; publishing with `qc.flag` is §8).
  - otherwise → the existing suspect / next-cycle confirmation logic.
- **Behaviour change:** the taught aim is no longer overwritten by a suspect or wrong-target reading. Before, one wrong lock saved the wrong prism's angle and the mistake repeated every cycle (f11p9 ↔ f11p11).
- ≥ 2 wrong targets in a cycle → warning `several-wrong-targets`.

### 3.3 Cycle screen (§7.1)

- Monitored cards: green / orange (above 10 mm or re-measured) / red (suspect, wrong target "probably hit A4", held) with a one-line reason; cards are re-stated as *held* when the orientation gate fires at the end.
- Reference cards: failures in plain words ("ATR found no prism near the aim (line of sight blocked …)", "no result within 30 s …"); excluded refs shown as *excluded* with the reason.
- Resection card (double width): RMS (and before exclusion), refs used, residual chips per ref (green < 5, orange 5–10, red > 10, excluded struck through), failed/excluded refs, frame change vs previous cycle with verdict, "Only 3 references — no redundancy".
- Header: quality pill + verdict (`held`), summary "Quality bad · HELD — nothing published · n ok / warning / suspect / wrong target / failed", gate messages listed.
- Log: the misleading `rotation=88.79 deg (large values = instrument relocated)` is replaced by `Cycle N frame vs cycle M: rotation x mgon, station shift y mm; reference observations moved z mm -> stable | solve moved | instrument moved`.

### 3.4 Verification

- `tests/test_quality.py` (17) + `tests/test_refound.py` (7): outlier excluded once (RMS 17 → < 0.01 mm), never below 4, LOO; orientation detected at 0.19° with A2/A7-like outliers listed; uniform shift ≠ pattern; frame jump vs relocation; full simulator cycles — normal ok + published, 3 refs held / nothing published / no baselines, excluded ref still ok, consecutive-exclusion warning, orientation error held, frame jump held then stable, relocation not held, wrong prism corrected by the narrow re-measure, wrong target flagged with `matchedPoint` and aim not overwritten, distance mismatch → wrong target, per-site config.
- Simulator over HTTP: REF4 46 mm off → excluded (RMS 17.4 → 0.73 mm), cycle ok; REF4+REF5 off → held `few-references`, 0 published; back to 4 refs → ok. Outbox counts match.

### 3.5 Acceptance replay — needs the station DB

`python scripts/replay_qc.py --db <copy of station ats_monitoring.db> --cycles 211-214,251-253 --out replay.md` — same gate code, coordinates as they were at each cycle (undoes later re-founds from `reference_coord_history`), read-only. It can't redo the live narrow re-measure, so wrong targets are judged from the stored observation (distance mismatch / sitting on another point). On the simulated DeVinci DBs it gives: R4 excluded in 211–214; #252 held `few-references` + `frame-jump` (+ `orientation-error` ≈ 0.18° in the rotated-coordinates scenario); A7 wrong target. **Send a copy of the DB (+ `-wal`) after the deploy and I'll post the real table here.**

### 3.6 Before deploying — please read

1. **Sites with only 3 references will be held every cycle** (nothing published). Either add a reference or set it per site: `POST /api/qc-settings {"min_refs_publish": 3}`. Check station 2 and any other station before deploying there.
2. After re-founding R4 the frame may shift a little; if it's > 20 mgon / 10 mm the next cycle is held once (`frame-jump`), then compares against that one and passes.
3. Cancelled cycles still publish the points measured before the stop (unless an early gate held the cycle), as before.
4. Not in this release: geometry-strength warning (§4 row, not in the requested list), "What now?" playbooks (§7.3), `qc.flag` / cycle summary / `frame-change` on MQTT (§8), settings UI.

**Files:** `engine/quality.py` (new), `engine/cycle.py`, `store/db.py` (columns `cycles.quality/held/qc_json`, `results.qc_flag/qc_reason/matched_point/held`, auto-migrated), `instrument/leica.py` + `simulator.py` (narrow ATR window), `api/monitoring.py` (cycle QC, export, qc-settings), `api/static/index.html`, `scripts/replay_qc.py`, `tests/test_quality.py`.

---

## 4. Release 2 + station health (2026-10-11) — one deploy

**Status:** implemented and tested on branch `quality-gates` (local, **not pushed, not deployed** — the station's `redeploy` pulls `main`). Replayed on the DeVinci DB copy of 2026-10-11. Findings that drove it: [`../../ats/devinci-diagnosis-2026-10-11.md`](../../ats/devinci-diagnosis-2026-10-11.md); plan: [`../../ats/ats-station-health-plan.md`](../../ats/ats-station-health-plan.md); **bridge message: [`../../ats/bridge-ats-health-handoff.md`](../../ats/bridge-ats-health-handoff.md)**.

### 4.1 What's new on top of §3

| Area | Change |
|---|---|
| Publishing | Never published as movement: `wrong-target`, `stuck-offset` (constant offset since a baseline taken in an untrustworthy cycle — few refs / RMS > 10 mm / held — or never near zero since the baseline), `too-large` (> 100 mm: operator review, never auto-confirmed). This closes the "repeats ⇒ confirmed" hole that published A2 / B1 / D8 / G11 / F11 / I11 / f8p1 (metres) and the ~100 mm / ~20 mm f-point groups since 08.10 |
| Station health | 10 checks per cycle (`engine/health.py`): instrument-rotation, instrument-stability (tilt start/end vs the last cycles, **R1 re-measured after the reference set** — drift > 5 mgon holds the cycle), reference-consistency (constant residuals + reference network), prism-constant (residual along the line of sight), geometry, swapped-prisms, stuck-offset, duplicate-points (same prism measured / same baseline), frame-offset (common vector), link |
| Cloud | `scanin/{gatewayId}/uplink/ats-health` per cycle (summary + quality + health), `uplink/ats-event` (`rebaseline`, `reference-refound`), new sample fields `qc_flag` / `matched_point` / `held` / `cycle_id`; held/flagged samples optionally published with `suspect: true` (`publish_flagged_samples`, off) |
| Re-baseline | `POST /api/points/rebaseline {point_ids, apply}` — preview then apply; new zero = mean of the last ≥ 2 agreeing positions from trusted cycles (≥ 4 refs, RMS ≤ 10 mm, not held, not wrong-target); history in `point_baseline_history`; `rebaseline` event to the cloud. UI: point menu "Re-baseline" and a "Re-baseline these N points…" button on the stuck-offset health row |
| Orientation gate | ignores points health already explains (stuck offset / another prism) — otherwise baselines taken in a rotated frame would hold every cycle and could never be re-baselined |
| Link | after a timeout + reconnect, and on any wrongly-shaped reply, the client drains late replies and resyncs on `CSV_GetInstrumentNo` before the next command (the 12:00 cascade: 59 points lost) |
| UI | "Station health" card (status per check, message, suggestion, re-baseline action); red cards / labels for stuck-offset and too-large; `GET /api/health` |
| Config (per site, `POST /api/qc-settings`) | `max_auto_disp_mm` 100, `publish_flagged_samples` 0, `ref_drift_check` 1, `ref_drift_warn/hold_mgon` 2 / 5, `rotation_warn_mgon` 10, `instrument_move_mm` 3, `tilt_jump_mgon` 20, `tilt_cycle_mgon` 5, `ref_constant_mm` 3, `geometry_ratio_warn` 3, `duplicate_mm` 30, `stuck_min_mm` 15, `stuck_repeat_mm` 5, `frame_offset_mm` 5 |

Cost: one extra 2-face target per cycle (the R1 repeat, ~25 s).

### 4.2 Replay on the DeVinci DB (cycles 211–214, 250–272)

Gates as in §3.5. Health on top — e.g. cycle 269:
- swapped-prisms: **D8 ↔ G11 swapped; on another prism: A2, B1, B2→E5, F11→G11, I11→H11**
- duplicate-points: **measured the same prism: B1 = f4p4, B2 = E5, H11 = I11**
- stuck-offset: **9 points baselined in cycle 215 (3 refs), 3 in 216, 5 in 234** (RMS 24–26 mm)
- reference-consistency: **R1 4.7 mm, R2 6.5 mm constant every cycle**
- frame-offset: **34 points share the same 7.8 mm offset**
- geometry: monitored points reach 4.1× the median reference distance
- would publish **34 of 58** points (vs all 58 before, metres included)
- tilt jumps flagged in 258/259/272; link problems in 250/272. The −28.5 mgon rotation of cycle 276 isn't in the DB copy (taken before it).

### 4.3 Tests

`python3 -m unittest discover -s tests` — 34 tests: §3's 25 + rotation vs move, swaps / same prism / duplicate baselines, common offset, prism constant, **instrument turning 30 mgon during the reference set → held**, steady instrument → health published, **untrusted 3-ref baseline → stuck-offset, not published → re-baseline → back near 0 and published**, too-large not published, **GeoCOM late reply dropped instead of shifting every reply**. Simulator over HTTP: wrong prism (MON1 aimed at a prism 0.75° away) corrected by the narrow re-measure; health card + messages queued.

### 4.4 Before deploying

1. Sites with only 3 references are held every cycle (`min_refs_publish`).
2. Expect DeVinci to show warnings until the site is fixed: swapped prisms, stuck offsets (until re-baselined), reference consistency (R1/R2), geometry. The ~17 stuck points stop publishing immediately (that's intended).
3. Re-baseline the stuck groups only once the frame is stable; the bridge must turn the `rebaseline` event into `ats-setup` baselines (or do it by hand meanwhile).

---

## 5. Recommendations tab (2026-10-11) — branch `recommendations`, not merged

**Status:** implemented and tested on branch `recommendations` (on top of `main` = release 2 + health, `4761d1a`). Not merged into `main`, not deployed — awaiting Hillel's approval.

- **What:** a "Recommendations" tab (badge with the open count) — the station's to-do list, one row per thing to do: *Re-aim D8 (swapped with G11)*, *Re-baseline f4p4*, *B1 and f4p4 measure the same prism*, *R2 is 6.5 mm off in every cycle*, *Check the instrument mount*, *Cycles held: too few references*… Each row: since which cycle, in how many cycles, evidence, suggestion, and action buttons (Auto re-aim, Steer, Re-aim here, Re-baseline, Re-found, Deactivate, Mark done, Dismiss). Below it: **Recent observations** (held / failed cycles, excluded references, instrument / link findings, re-founds, re-baselines, items opened / closed).
- **Lifecycle** (`recommendations` table): an item seen again is updated; resolved automatically after **2 consecutive cycles that could see it and didn't** (a point not measured, or a held cycle, never resolves anything); instrument items close only by the operator; a closed item that comes back opens a new one (history kept); dismissed items stay dismissed.
- **Auto re-aim** (`POST /api/points/reaim-expected`): aims at the point's expected position (baseline in the latest trusted frame), locks with a ±0.5° ATR window, saves the aim **only** if the prism found is the point's own (position + distance within 50 mm, not another point's position). If the only prism there is the one the cycles already measure, it says so: the aim is right, the baseline is wrong → Re-baseline.
- **Cloud:** open items go out in `ats-health.recommendations` (flat, see the bridge handoff §3.1).
- **Replay on DeVinci (cycles 253–272):** 32 open items at cycle 272 — 8 re-aims (A2, B1, B2→E5, D8↔G11, F11→G11, I11→H11, f8p1→f7p14), 17 re-baselines (the cycle-215/216/234 groups), B1 = f4p4, R1 / R2 constant offsets, common 7.8 mm offset, geometry, link (cycle 272), held cycles (270/271).
- **Tests:** 46 (`tests/test_recommendations.py`: lifecycle, held cycles, operator-only items, dismissed, explained duplicates, thin-data checks, wrong prism → item → auto re-aim refused while the prism is hidden → succeeds → resolved after 2 clean cycles; auto re-aim says "baseline" when the aim is right).
