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
