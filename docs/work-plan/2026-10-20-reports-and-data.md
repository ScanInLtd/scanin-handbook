# Work plan — reports & data sanity (2026-10-20)

_Status: DRAFT for review (Hillel). Source list: Hillel 2026-10-20 (priority order as given). Findings: read-only checks on prod the same day (scripts under `ops/src/`)._

## 1. The list (as given)

| # | Task (Hillel's words, translated) |
|---|---|
| 1 | **Ironing:** the iron tool stopped working after the MA + baseline changes. Dozens of DeVinci sensors (all station ATS-5) show a significant *temporary* baseline shift. Maybe iron automatically instead of fixing the old iron (see #6). |
| 2 | **Holes in reports:** e.g. Shtraus 4 report. Probably MA wasn't completed backwards for all sensors. Complete it and handle past data problems. |
| 3 | **Maccabi Yafo report:** a demo report with sample data (not real). Produce it from the site's start to 15.10.26. In the past we ran a gentle, realistic data generator. The demo must show ~3 mm settlement from start to end. |
| 4 | **Police report:** stuck or doesn't send emails. Fix and produce it. |
| 5 | **Reports system improvements:** explanation page after the cover and at the end, with a reusable page library. **Merged report** = several existing reports in one file, each with its own image; the UI allows a date range per report (override) and toggles for explanation pages per sub-report and for the merged report. Mind performance and job chaining, since a single report is already slow and heavy. |
| 6 | **Sites like JAFFA_68** (`e2NemfiQGhgKTW2FgJtu`, confirmed by Nathan): complete MA from the beginning, or at least the last year, so reports can be produced. (Maybe the same as #1?) |
| 7 | **Datalogger flashing tool:** send an install link to Nathan / Lidor. Before that, review and upgrade it; today's JTAG cables send reset+boot automatically. |
| 8 | **UI: delete a baseline.** |
| 9 | **Sensor chart:** after deleting a point you need a Fetch to see it. Fix. |
| 10 | **Site / floor map bug:** hovering a sensor pin enlarges *all* pins, so you can't tell which one will open (e.g. DeVinci). |
| 11 | **Cut ATS-site alerts to the management group** drastically. It's "wolf wolf": the sites aren't that bad, we're just flooded. Filter, aggregate, etc. |

## 2. What I found (2026-10-20)

| # | Finding | Evidence |
|---|---|---|
| 1 | **Root cause of the broken iron:** the iron (chart context menu → "Start Adjustment Tool") writes `adjustment-requests`. Since the UI switched to registry labels, `referenceAxis` holds the **Hebrew label** (`"תזוזה Z (mm) —"`) instead of the field name (`HeightDisplacement`). The adjustments worker completes every request with **`processedDocs: 0`**. Even when it worked, ironing rewrote raw values, which conflicts with the new model (raw is never altered, `smooth` is stored per sample, baselines are piecewise events), so the smoothed line wouldn't follow without a recompute. **Example:** DeVinci `f6p6` X, raw steps about −14 mm on 10-09 and stays there until the station-wide `rebaseline` on 10-16 01:15 (ATS-5), so the 48h line sits at −12…−14 for a week. | `adjustment-requests` (last 3: all `processedDocs: 0`), screenshot |
| 2 | **Shtraus 4:** the prisms **do** have smooth back to March (94–98% of samples). The holes are mostly **real data gaps**: per prism ~140–160 samples/month normally, but June ~30, September ~22, October ~14. The report breaks the line when a gap is longer than 2× the window (96h for prisms). → It's an ingestion/station question (why so few Shtraus samples?), plus a presentation policy. | `ops/src/analysis/smooth-history.ts` |
| 6 | **The full-history smoothing backfill was never finished.** Only the 90-day backfill (2026-10-04) ran fleet-wide. The full-history run stopped part-way (checkpoint `fullhist-dryrun`: 121/272 sensors). **JAFFA_68:** 0% smooth before July 2026, so reports before July are empty on the main line. Shtraus happens to be among the done ones. | `smooth-history.ts`, functions feedback phase 2 §9.3 |
| 4 | **Police report** (REP142, `ReportConfig/BZCmhu7KyRw5TIAlYkGc`, manual, 5 sensors, 15.09–15.10): generated fine on 10-18 (41 s), but **the PDF is 55.6 MB** and the email (~71 MB with encoding) is over SendGrid's 30 MB limit, so **no email**. The cover image is only 0.4 MB, so something else bloats the PDF (likely chart images or fonts per page). | reports-worker logs 2026-10-18 05:25Z: `Email too large: 71MB > 30MB SendGrid limit` |
| 11 | **Target = the internal group "TerraScan Monitoring Data Alerts"** (Hillel). Internal notices (`data-integrity`) last 7 days: **62**: unconfirmed-sensor 14, ats-rebaseline 11, level-shift 10, implausible-jump 7, ats-point-issues 6, ats-station-health 4, ats-cycle-held 4, ats-station-silent 4, late-data 2. By site: DeVinci 26, NAVON 13, no site 14. Separately, on the client side: **last 7 days: 206 client alerts.** **114 (55%) come from one sensor**, `VIB_JTCS_NAVON_1` (vibration DIN, NAVON; DIN throttle is 60 s by design). DeVinci 60, SAVYON ~16. Internal notices (`data-integrity`) 62/7d: unconfirmed-sensor 14, ats-rebaseline 11, level-shift 10, implausible-jump 7, ats-* station/cycle 18. WhatsApp: 121 alerts show `sent=2 failed=1`, so one recipient fails consistently. | `ops/src/analysis/notice-volume.ts`, `alerts.ts` |
| 3 | **Maccabi Yafo today** (19 prisms, data from 2026-05-19): real data mostly ends **2026-06-23**, some prisms 07-23 or 08-11. The previous fill (runbook `scanin-tool-data-replay/docs/prism-gap-fill-runbook.md`, `gap-fill.js`) covers **only 9 prisms** (a3, a4, a7, a8, R11–R15) and ends **2026-09-23**. R1–R10 have no fill at all, and **R9 has no data**. **Height change start→end is about 0** (−1.1…+1.1 mm raw), as the runbook's "calm site, ±2 mm" rule intends, so **there is no 3 mm settlement**. **None of the samples has `smooth`** in this window (the report's main line would be empty): check why (replay handling or backfill scope) before rerunning. The runbook has **no trend option**; a 3 mm settlement needs a new `--trend` (e.g. linear −3 mm on H from site start to 15.10.26) on top of copy-&-follow. | `ops/src/analysis/settlement-span.ts` |
| 8 | No delete path exists: `setBaseline` callable only. Needs a `deleteBaseline` callable (delete the event, recompute from its time) plus a UI action. Pairs with #1 if ironing becomes "baseline events". | functions `setBaseline.ts` |
| 9, 10 | Small UI bugs in `scanin-web-platform`: delete-point doesn't update the chart's local data; map hover style applies to all pins. The last map change was `3ffd0ca` "tweak map page ui" (10-18), worth checking first. | |
| 7 | `scanin-tool-esp-flasher`: last commit Jan 2026. Needs review (esptool auto-reset via DTR/RTS or native USB-JTAG on S3), packaging, and a link. Independent of everything else. | |

## 3. The plan

### Track A — Data correct enough for reports (foundation for #2, #6, #1)
- **A1. Finish the full-history smoothing backfill** fleet-wide (#6, #2).
  - The tool exists: `scripts/recompute-smoothing.js --all-active --days=all --resume=… --max-minutes=…` in functions. Exclude the 4 office test rigs (≈5.4M docs, no value).
  - Estimated ~$15 and a few hours.
  - Writes only `smooth/eval/suspect` fields. Needs Hillel's approval, run in slices.
  - Then re-run `smooth-history.ts` per active site.
- **A2. Replace the iron with a non-destructive "temporary step" correction** (#1).
  - A temporary shift = **a pair of baseline events**: one at the step start (new level) and one at the step end (back), then `recomputeSmoothing` over the window. Raw stays untouched; it's reversible and visible as markers.
  - **Station-wide variant for ATS:** when many points of one station step together (DeVinci ATS-5, 10-09 → 10-16), one action creates the pair for all affected sensors. Detection reuses `detectLevelShifts` + common-mode (the run check from the plan).
  - **Interim quick fix (optional):** make the old iron send the field name, and call `recomputeSmoothing` after it. Not recommended long-term, since it rewrites raw.
- **A3. Delete baseline event** (#8). A `deleteBaseline` callable (admin) → recompute from the event time; a UI action on the baseline marker. Required before A2 goes live (undo).
- **A4. Fix DeVinci ATS-5 10-09…10-16** with A2 once it ships (dry-run list of affected sensors first).

### Track B — Reports
- **B1. Police report unblock** (#4).
  - Now: send the generated PDF as a download link manually, if it exists in Storage.
  - Fix: find what bloats the PDF (55.6 MB for 5 sensors × 1 month). Likely candidates: chart PNG resolution / sampling off, duplicated base64 images, embedded fonts.
  - Plus a guard: above the limit, email a **signed download link** instead of the attachment.
  - **Done 2026-10-20** (`scanin-svc-reports` `1c32d28`): the cause was the section map images (phone photos, 5712×4284) embedded at full resolution per sensor page. Every remote image is now downscaled to 1600 px JPEG before the PDF step. REP142: 55.6 MB → 2.9 MB. Also `scripts/entry-points/render-only.js` (local render, no status writes, no email).
- **B5. Oversized images in Storage** (follow-up from B1, Hillel 2026-10-20).
  - The UI loads the same 24 MP photos on the site / floor map pages (slow; may relate to #10).
  - **At upload (web-platform):** resize maps and covers in the browser before upload (e.g. max 2400 px, JPEG ~85%).
  - **One-off cleanup (handbook oneoff, dry-run → approval):** list oversized images under `images/` and `report-covers/`, back up each original to `originals/<same path>`, overwrite in place with the smaller version (same object path, same download token, so every existing link keeps working).
- **B2. Maccabi Yafo demo** (#3). The report must look like real data (Hillel).
  - Follow the existing runbook (`scanin-tool-data-replay/docs/prism-gap-fill-runbook.md`: report → backup → fill dry-run → apply → daily rebuild → verify).
  - Add `--trend` to `gap-fill.js`: a target settlement over the window (e.g. −3 mm on H from site start to 15.10.26), keeping each prism's own noise character. Extend the fill to **all** active prisms (R1–R10 too) up to **15.10.26**. Decide what to do with R9 (no data).
  - Replace the rebuild step with `recomputeSmoothing` (prism-daily is being retired). First find out why there is no `smooth` on the existing Maccabi samples.
  - **Report option** so that replayed data is drawn like real data, with no dashed segments and no "נתונים משוחזרים" footnote, e.g. `ReportConfig.markReplay: false` (default stays true). Synthetic docs stay `isReplay` in the DB.
  - Then run the report from the site's start to 15.10.26.
  - Dry-run, backup, Hillel's approval.
- **B4. Gaps in reports** (#2, Hillel: connect with lines, but see it first).
  - Report option `connectGaps` (draw the line across real data gaps; default off until Hillel approves).
  - Render Shtraus 4 both ways for Hillel.
  - If needed, fill Shtraus gaps with demo data the same way as B2, as a temporary measure until the system runs in steady production.
  - In parallel: find out why Shtraus has so few samples in Jun/Sep/Oct (station / ingestion).
- **B3. Explanation pages + merged reports** (#5). Spec first (handbook), then implementation:
  - **Explanation page library:** a Firestore collection with title, rich text and images. Per config: intro page after the cover and closing page.
  - **Merged report:** a config that lists child configs, each with an optional period override, its own cover image and an explanation toggle, plus merged-level explanation pages.
  - **Performance and chaining:** the orchestrator fans out one job per child, each worker renders its part PDF into Storage, and a final "merge" job concatenates them (pdf-lib). Progress per part, and resume on failure. Delivery by link when large (shares B1's guard).

### Track C — UI fixes (`scanin-web-platform`)
- **C1.** Delete point → chart updates without Fetch (#9).
- **C2.** Map pin hover affects only the hovered pin (#10). Check `3ffd0ca` first.
- **C3.** UI part of A3 (delete baseline from the marker) and A2 (the "temporary step" action).

### Track D — Notice noise in "TerraScan Monitoring Data Alerts" (#11)
- **D1. Measure what the group actually receives:** messages per day by kind, site and station, including ATS station-health messages (`ats-*`). Which ones did anyone act on?
- **D2. Cut and aggregate:**
  - One message per station per cycle problem, not per point.
  - Don't notify on kinds that resolve themselves (e.g. `ats-rebaseline` after a station re-baseline, `unconfirmed-sensor` repeats).
  - One daily digest for low-severity kinds; immediate messages only for things that need action now (station silent, a bad cycle that is held).
- **D3. Client side (separate, noted):** `VIB_JTCS_NAVON_1` alone is 55% of client alerts (114 of 206 in 7 days). Check its thresholds and placement, or add a DIN digest. Also fix the consistently failing WhatsApp recipient (121 × `failed=1`).

### Track E — Tools
- **E1.** ESP flasher review + upgrade (auto reset/boot) + installer link for Nathan / Lidor (#7).

## 4. Suggested order (real-world flow)

| When | What | Why first |
|---|---|---|
| **Now** (hours) | **B1** unblock police (manual link) · **A1** start the full-history backfill, JAFFA_68 first (approval) · **D1** measure the group's messages | Client-facing, cheap, unblocks #2/#6 reports |
| **This week** | **A3 + A2** (functions + UI), then **A4** DeVinci fix · **B1** size fix + link guard · **B2** Maccabi demo · **B4** connect-gaps preview · **C1, C2** · **D2** first cuts | A2 needs A3 (undo). B2/B4 share the report options and the fill tool. UI bugs are small and parallel |
| **Next** | **B3** spec → implementation · **D2** rest + **D3** · **E1** | Larger design work; B3 reuses B1's delivery guard |

**Parallel agents (one per repo at a time, so no two agents in the same repo):**

| Agent | Repo | Tasks (in order) |
|---|---|---|
| 1 | `scanin-svc-firebase-functions` | A3 backend → A2 backend (+ station-wide detect) → D2 (notice aggregation) → D3 |
| 2 | `scanin-web-platform` | C1, C2 → C3 (after agent 1's callables) |
| 3 | `scanin-svc-reports` | B1 (size + link guard) → B2/B4 report options (`markReplay`, `connectGaps`) → B3 |
| 4 | `scanin-tool-data-replay` | B2 `--trend` + Maccabi fill (dry-run) → B4 Shtraus fill if wanted |
| 5 | `scanin-tool-esp-flasher` | E1 |
| me (handbook) | ops | A1 run + verification, B1 manual unblock, D1 measurement, A4 dry-run, regression checks |

## 5. Answers (Hillel, 2026-10-20)

1. **#6:** JAFFA_68 (`e2NemfiQGhgKTW2FgJtu`), confirmed by Nathan.
2. **#11:** the internal group "TerraScan Monitoring Data Alerts".
3. **#3:** the demo must look like real data. Use the existing gap-fill runbook (done several times on this site).
4. **#2:** connect the line across gaps, but Hillel wants to see it first. Possibly fill gaps with demo data as a temporary solution until the system is steady and in real production.
