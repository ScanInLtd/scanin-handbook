# Task: resection quality, diagnostics and guided recovery (ATS monitoring app)

_Repo: `scanin-fw-ats-monitoring` · Written 2026-10-08 (Hillel + handbook) · Status: TODO_
_Reply with the implementation summary in `../signal-and-alerts/feedbacks/ats-resection-quality.md`._
_Don't deploy to a station PC without Hillel's approval. Step 0 is read-only and urgent._

---

## 0. Urgent, read-only: diagnose DeVinci station 5 now

We're stuck on site (details in §1). Before any feature work, write `scripts/diagnose_cycles.py`, which runs on the station PC against the local DB and changes nothing. Produce a report (Markdown + CSV) for cycles **211–214, 251 and 252** (and the last 20 by default):

- **References, per cycle:** slope distance, Hz/V, face I − face II difference, ATR offset (if the instrument returns it), residual after the solve, and the stored site coordinates.
- **Reference network check:** distances between every pair of references, as measured in that cycle, vs the distances implied by their stored site coordinates. This shows which reference moved, independently of any solve.
- **Leave-one-out:** for each cycle with ≥4 references, solve again without each reference in turn. Report the RMS for each. A reference whose removal collapses the RMS is the culprit.
- **Transform:** translation and rotation, plus the **change vs the previous cycle** (mm, mgon). Distinguish a real relocation from a "solve moved".
- **Monitored points:** aim used (taught or predicted, and the angle difference), measured distance, the distance expected from the baseline and transform, displacement (dE, dN, dU, 3D), suspect / re-measure details.
- **Distance pattern:** fit 3D displacement vs distance over the monitored points of the cycle. A strong linear fit means an **orientation error**. Report the implied rotation (mrad / mgon) and which points don't fit (probable wrong targets).
- **Subset solves:** also solve each cycle using only R1+R2+R3, and R1+R2+R3+R5, to show how sensitive the frame is to the reference set.

Send the report to the handbook (`docs/ats/devinci-diagnosis-2026-10-08.md`). That alone should tell us which references are trustworthy.

---

## 1. Background: DeVinci station 5 (`DeVinci-1`), what happened

| When | What we saw | What it means |
|---|---|---|
| Since at least 03.10 | Every cycle "PASSED" with **RMS 23.4 mm**. Residuals: `R1 11.1 · R2 12.1 · R3 12.1 · R4 45.9 · R5 14.7 mm`, the same in every cycle | **R4 is ~46 mm off, stable** → it moved, or its stored coordinates are wrong. It pulls the whole fit, so the other references look 11–15 mm off. The cloud thresholds are 4/6 mm, so a 23 mm station error is bigger than the movement we monitor |
| 06–08.10 | Monitored points measured on the **wrong prism**: f11p9 ↔ f11p11 returned each other's position (ΔY +7522 / −7526, ΔZ −1533 / +1535 mm); similar on f11p8, f11p12, f8p1 (station 5), f4p1, f11p3 (station 2) | ATR locks onto a neighbouring prism. The cloud blocks these as suspect, but the station should catch them |
| 08.10 | R4 deactivated on site | |
| 08.10, cycle **#252** ("Run cycle") | **R5 timed out** (30 s). Resection from **3 references** (R1, R2, R3): **RMS 1.8 mm**, "PASSED". Monitored: **A4 66.2 m → 218 mm, A8 65.1 m → 214 mm** (≈ **3.3 mm per meter**), A2 → 1382 mm, A7 → **57 654 mm**. All shown as green "PASSED". Hillel stopped the cycle | The proportional displacement means **orientation error ≈ 0.19°**. With only 3 references the solve has no redundancy, so the RMS looks great while the frame is wrong. A2 and A7 don't fit the pattern, so they're wrong targets on top |

Reference distances in #252 matched the previous cycles to 0.2 mm (R1 17.616, R2 18.7805, R3 76.612), so the same prisms were measured. The problem is the *combination* of references vs their stored coordinates (R1 and R2 are close to the instrument and to each other, so the geometry may be weak), or one of them also moved.

What the app does today (verified in code):

| Action | What it changes |
|---|---|
| Teach on a **new** reference | measures it and sets its site coordinates from the instrument frame (only valid in the original setup) |
| Teach / Re-aim on an **existing** point | aim angle only. Coordinates and baseline are kept |
| Go to | nothing (just turns the instrument) |
| Resection → Measure | nothing (one reading for the manual resection) |
| Resection (solve) | **every point's aim angle**, from the solved transform. Coordinates unchanged |
| Run cycle | measures references → solves → measures monitored points (taught aim, or predicted aim if the difference is > 2°) → displacement vs the fixed baseline → publish (suspects held) |

There's no way to fix a moved reference without breaking the frame. The resection step is "passed" regardless of RMS, reference count or geometry. Residuals only reach the event log.

---

## 2. Concepts the user must see in plain words (glossary in the UI + docs)

Show these in a "?" panel on the resection and cycle screens:

- **Reference:** a prism that's assumed not to move. Its **site coordinates** define the frame.
- **Monitored point:** a prism we watch. Its **baseline** = its site coordinates when first measured. Displacement is always vs the baseline.
- **Aim angle:** where the instrument turns to find a prism. It's only a starting direction, refined by ATR. It doesn't affect coordinates.
- **Resection:** solving where the instrument is, and how it's rotated, from the references.
- **Residual:** how far one reference is from where its coordinates say, after the solve. **RMS** = the overall size of the residuals.
- **Redundancy:** 3 references are the minimum, so errors stay hidden. With 4 or more, a bad reference shows up.
- **Relocation:** if the solve says the instrument moved (aim difference > 2°), the cycle aims at predicted positions.
- **Suspect:** a result the app doesn't trust yet. It's re-measured and held (not published) until confirmed.
- **Wrong target:** the instrument measured a different prism than intended.
- **Orientation error:** the station's rotation is solved wrong, so every point "moves" in proportion to its distance.

---

## 3. Diagnostics and logging (make the problem visible without exporting logs)

1. **A cycle diagnostic record** stored with every cycle and viewable in the UI. It holds everything from §0 for that cycle: references with residuals and face difference, transform plus the change vs the previous cycle, monitored points with aim source, expected vs measured distance, displacement, and suspect reason.
2. **"Compare with previous cycle"** view: per point, the change since the last cycle, and the transform change.
3. **Export cycle report** (one click, Markdown/CSV): attachable to a WhatsApp/email. That replaces copying the event log.
4. **Publish a cycle summary to the cloud** (topic or message used by the bridge → Firestore `ats-runs`):
   `{cycleId, siteId, startedAt, refsUsed[], refsExcluded[], refsFailed[{id, reason}], rmsMm, residualsMm{}, transformDelta{mm, mgon}, quality: ok|warning|bad, nMonitored, nOk, nSuspect, nWrongTarget, nFailed, orientationErrorMgon?}`.
   The handbook and the watchdog will alert on station quality from it.
5. **Event log wording:** a reference failure says why in plain words ("ATR didn't find the prism within 30 s — line of sight / prism blocked / aim off?").

---

## 4. Quality gates: the cycle decides what it can trust

Configurable per site. Defaults in brackets.

| Gate | Rule | Effect |
|---|---|---|
| **Reference count** | references used < `min_refs_publish` [4] | Measure and store everything, but **hold the cycle** (`quality=bad`, `qc.flag="few-references"`): nothing is published as movement. Below 3, the cycle fails, as today |
| **RMS** | > `rms_warn_mm` [5] → warning; > `rms_fail_mm` [10] → bad | Bad → hold (`qc.flag="bad-resection"`) |
| **Outlier reference** | ≥4 refs and max residual > 3× the median and > 10 mm | Auto-exclude it, solve again, and keep the result if the RMS is < half. One exclusion per cycle, never below 4. Log it. The same reference excluded in 3 consecutive cycles → station warning "R4 consistently off — check on site" |
| **Leave-one-out** | ≥4 refs: solve without each reference | If removing one reference drops the RMS below warn while the full set is above it → flag that reference (same as above) |
| **Transform jump** | rotation or translation change vs the previous cycle above `frame_jump_mgon` [20] / `frame_jump_mm` [10], **without** relocation detected (aims within 2°) | Hold the cycle: "the station frame changed — reference set or a moved reference?" |
| **Geometry strength** | weak reference geometry (e.g. two references within 5° of each other as seen from the instrument, or a high condition number of the solve) | Warning on the resection card: "weak geometry — add a reference in another direction" |
| **Orientation pattern** | ≥4 monitored points with displacement > 10 mm and a strong linear fit to distance (R² > 0.9) | Hold the cycle, `qc.flag="orientation-error"`, and show the implied rotation. Points that don't fit get their own check (wrong target) |

Held cycles are visible and exportable, never silently dropped. The user can **re-run** after fixing the cause.

---

## 5. Wrong-target detection for monitored points

- After each monitored measurement, compare the 3D result (site frame) with the expected position (baseline / last good).
- If it's off by more than the tolerance [50 mm, per point]: re-measure once with a narrowed ATR window / PowerSearch off.
- If it's still off **and** within tolerance of **another** point's expected position → `qc.flag="wrong-target"`, `matchedPoint`. Don't publish it as this point's movement (publish with the flag for the audit trail). Log it.
- Prefer comparing the **measured distance with the expected distance** first. It's a cheap, transform-independent check: A7 measured 32.56 m where ~60 m was expected, which is an obvious wrong target.
- Several wrong targets in one cycle → station warning.

---

## 6. Fixing references without breaking the frame

1. **Re-found reference from current resection.** Precondition: a resection from the **other** references with ≥4 references (or 3 plus the user's explicit confirmation) and RMS < warn. Measure the reference (2 faces if the schedule uses 2), apply the transform, and store the result as its new site coordinates. Keep history in `reference_coord_history` (time, old, new, reason, the RMS used). The confirm dialog shows old vs new coordinates and the size of the change. Re-enable the reference afterwards.
2. **Reference health view:** per reference, the residual history, the network-distance check (§0) and its status (trusted / suspect / disabled), plus a suggestion ("R4: 46 mm for 5 days → re-found from current resection").
3. **Frame re-base (advanced, admin only, last resort):** when several references moved and a clean subset can't be trusted, re-establish the frame from new reference coordinates **and** transform every stored site coordinate (references + monitored baselines) by the same fitted transform. That keeps displacement continuity. Requires a confirm step, a dry-run preview (old vs new for every point), full history, and a `frame-change` event to the cloud (§8).

---

## 7. UI: make the cycle screen tell the truth, and make the actions clear

### 7.1 Cycle screen
- **Monitored cards:** green = normal; orange = above warn or re-measured; red = suspect, wrong target ("probably hit A4") or held. One line with the reason, e.g. "218 mm vs 0.4 mm last cycle — part of an orientation error (3.3 mm/m), held". Never a plain green "PASSED" for a non-normal result.
- **Reference cards:** a failure in plain words. A reference excluded by a gate is shown as excluded, with the reason.
- **Resection card:** RMS, references used / failed / excluded, the residual per reference (colours: green < 5, orange 5–10, red > 10 mm), the transform change vs the previous cycle, the geometry warning, and "only 3 references — no redundancy" when that applies.
- **Cycle header:** `quality` (ok / warning / bad) and whether results were **published or held**, plus a summary line: n ok / suspect / wrong target / failed.
- When the cycle is held or bad: a **"What now?"** button that opens the matching playbook (§7.3).

### 7.2 Clear point actions (rename + one-line explanation under each button)
| Today | Proposed label | What it changes |
|---|---|---|
| Teach (new reference) | **Create reference here** | measures it and sets its coordinates (only in the original setup) |
| Teach / Re-aim (existing point) | **Fix aim (keep coordinates)** | aim angle only. Coordinates and baseline unchanged |
| Go to | **Point the instrument here** | nothing is saved |
| Resection → Measure | **Measure reference for resection** | nothing is saved until "Solve" |
| Resection | **Solve station position** | every point's aim angle. Coordinates unchanged |
| (new) | **Re-found reference from current resection** | that reference's coordinates (history kept) |
| (new) | **Run diagnostic cycle** | measures everything, publishes nothing, produces the §3 report |

### 7.3 Guided playbooks ("What now?"): built into the UI and in `docs/troubleshooting.md`

| Scenario (how the app detects it) | What the app does automatically | What the user should do (guided) |
|---|---|---|
| **A. One reference consistently off** (outlier gate, leave-one-out) | Excludes it from the solve, flags it in reference health | Check it physically (moved, replaced, on something that moves?). When understood: **Re-found reference from current resection** |
| **B. A reference fails to measure** (timeout, no ATR lock) | Retries once with PowerSearch / a wider window; continues if ≥4 references remain, else holds the cycle | Check the line of sight and the prism (someone standing in front, dust, cover). Point the instrument at it and run **Fix aim** if it's off, then re-run |
| **C. Only 3 references** (count gate) | Holds the cycle (no publishing) | Bring a failed / disabled reference back (B / A), or add a new reference in a different direction, then re-run |
| **D. Many points "move" in proportion to distance** (orientation pattern, transform jump) | Holds the cycle; shows the implied rotation and which reference set was used | Usually C or A in disguise: run a **diagnostic cycle**, look at reference health / leave-one-out, fix the bad or missing reference, re-run. Don't "Fix aim" monitored points: their aims are fine |
| **E. One point jumps by meters / mirrors another** (wrong-target check) | Re-measures with a narrow ATR window; flags wrong-target with `matchedPoint` | On site: point the instrument at the right prism and **Fix aim**. If the two prisms are too close for ATR, report it (physical change needed) |
| **F. Instrument moved / bumped** (large translation/rotation, many aims > 2°) | Relocation flow (predicted aims); the first cycle after relocation is held for confirmation | Check level and stability; ensure ≥4 references are visible; run **Solve station position** if needed, then a cycle |
| **G. Several references drift over time** (reference health trends, network check) | Station warning | Plan a frame re-base (§6.3) with the handbook. It needs cloud coordination |

---

## 8. Cloud contract (bridge + functions will consume these)

- `qc.flag` on published samples: `few-references` · `bad-resection` · `orientation-error` · `wrong-target` (with `matchedPoint`) · `held-unconfirmed`. Flagged samples are marked suspect in the cloud and never alert clients.
- **Cycle summary** message (§3.4).
- **`frame-change` event** whenever the reference set, or a reference's coordinates, change (re-found, exclusion becoming permanent, re-base): `{siteId, at, reason, refsBefore, refsAfter, transformDelta}`. The cloud uses it to set an `ats-setup` baseline on that station's points automatically (today Hillel does it by hand). That's handbook task ATS-1.3.
- Document all fields in the protocol doc and tell the handbook when they're live.

---

## 9. Verification

- Unit tests: an injected outlier reference → excluded, RMS drops, at most one exclusion; leave-one-out finds it; a 3-reference cycle is held; the orientation pattern is detected from synthetic proportional displacements; a transform jump without relocation → held.
- **Replay DeVinci cycles 211–214, 251 and 252** from the station DB: R4 flagged; #252 held as `few-references` plus `orientation-error` (~0.19°); A2 / A7 flagged wrong target.
- A simulated swap of two points' observations → both flagged `wrong-target` with the right `matchedPoint`.
- UI screenshots: resection card with residuals (one red), a held cycle with the "What now?" playbook, the reference-health view, the re-found dialog, and the renamed actions.

## 10. Deploy

- Step 0 report first (read-only; can run now).
- Build and deploy per `docs/fresh-pc-install.md` / the usual procedure **after Hillel approves**. DeVinci station 5 first: watch 2–3 cycles, then the other stations.
- Tell the handbook when `qc.flag`, the cycle summary and `frame-change` are live.
