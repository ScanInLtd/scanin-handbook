# Runbook — Prism reports with holes in the MA line

_First written 2026-10-25 after DeVinci (10-06 → 10-23) and SAVYON / NEVIIM 61 / MERCANTIL (10-25). Use it for any site where Nathan says "the report has gaps" or "the line is wrong"._

The report draws the server-computed moving average (`smooth` on each `data-log` doc, 48h window for prisms). A hole in the report means samples without `smooth`. There are only four causes, and each has its own fix. **Always diagnose first. Most sites need only step 3.**

| Cause | How it shows in `ma-gaps.ts` | Fix |
|---|---|---|
| **Never computed**: the data is fine, but the MA was never calculated (the fleet backfill covered 90 days; older history only for prisms someone touched) | `missing but RECOMPUTABLE` high, typically months before 2026-07 | Step 3: full-history recompute. Cheap, safe. |
| **Sparse data**: too few samples in the 48h window (min-n), or readings only part of the day (< 3 of 4 six-hour quarters) | `min-n` / `coverage` | Not fixable by recompute. The report bridges it (`connectGaps`, default on, step 5). |
| **No data**: station outage, no readings at all | `data gaps ≥ 48h` | Not fixable (raw data doesn't exist). The report bridges it. |
| **Wrong level eras**: giant steps (hundreds to thousands of mm) where a prism shows another point / frame / zero for a while | dry-run recompute shows `drift` re-seeds at giant ref values (step 3), and `step-inventory --min=200` lists them | Step 4: Nathan reviews → ironing. **Don't recompute these sites before that.** |

Auth for every step: `./go.sh preflight` once, then `./go.sh run <script>` (handbook `ops/`). The recompute runs in the functions repo with `GOOGLE_APPLICATION_CREDENTIALS=~/.config/gcloud-scanin/application_default_credentials.json`.

## 1. Diagnose (read-only, a minute per site)

```bash
./go.sh run src/analysis/ma-gaps.ts <projectId|name>[,…] --from=365d --sensors --json=out/ma-gaps-<site>-<date>.json
./go.sh run src/analysis/ma-gaps.ts --all-active --from=365d          # the whole fleet
```

- Per month and per prism: % with MA, then the **reason** for each missing sample (same gates as functions `smoothing.ts`), "report holes" (≥ 24h without MA) and data gaps.
- Within one site, some prisms at 90 %+ and others at 0–15 % = "never computed" (the 90 % ones were recomputed by hand once).

## 2. Check the report configs

`./go.sh run src/queries/report-status.ts <project>`: recipients, schedule, last run (`lastStatusDetails.emailSent` / `emailSkipReason` say whether the email went out).

## 3. Full-history recompute (dry-run first, always)

```bash
cd ../scanin-svc-firebase-functions        # lib/ must be the deployed build (git log -1 == deployed commit)
GOOGLE_APPLICATION_CREDENTIALS=… node scripts/recompute-smoothing.js --project=<id>[,<id>…] --days=all --type=prism            # dry-run
GOOGLE_APPLICATION_CREDENTIALS=… node scripts/recompute-smoothing.js --project=<id>[,<id>…] --days=all --type=prism --apply    # Hillel's OK
```

**Go / no-go from the dry-run:**
- **Totals:** `smooth=` should be ~90 %. The rest is `missMinN` / `missCoverage`, i.e. sparse data.
- **Re-seed kinds:** `grep -o '([a-z-]*)' <log> | sort | uniq -c`. Only `chain-start` → **go**.
- **No-go:** any re-seed without `chain-start` whose `ref=` is hundreds or thousands of mm (e.g. `ref=-2720.6 (run n=5)`). The MA would follow a wrong era, which shows as thousands-of-mm lines in reports. Fix those sensors first (step 4), then recompute.
- **Safety:** the recompute only **updates** existing samples. `checkThresholds` is `onCreate`, so **no alerts / WhatsApp** are triggered. Cost is cents (35 prisms ≈ 73k writes ≈ $0.13).

Then re-run step 1 to verify.

## 4. Giant steps → ironing (only with Nathan's decisions)

1. **Inventory:** `./go.sh run src/analysis/step-inventory.ts <project> --from=2025-01-01 --min=200 --out=review/steps-<site>.json`.
   - The inventory **includes suspect samples**. A station-wide "step" that's all `suspect: implausible-jump` (e.g. ATS-6 bad frames 23.09 → 12.10) is already excluded from the MA and needs no ironing. Check a sensor with `src/queries/data-log.ts <id> --from= --to=` before believing a big group.
2. **Review:** `src/review/jump-review.ts` builds the HTML for Nathan. His answers go to `review/<…>-answers.json` (`iron` / `real` / `unsure`). "Two prisms in one sensor" is **not** ironing: it's a mapping fix.
3. **Plan + backup:** `./go.sh run src/oneoff/2026-10-25-iron-approved.ts --answers=<answers.json> [--only=<ids>] --backup`.
   - It irons the approved windows. If the approved click was a *return* to zero, it adds the start of that wrong era. Each iron event shifts the zero by exactly the step, with reason `iron`, so the MA spans it.
   - **SAFETY: read "current level after plan" for every sensor.** If today's level ends far from 0, the plan is wrong for that sensor (it flips between levels). Leave it out (`--only=` the clean ones) and send it back to Nathan.
4. **Apply:** `cd ../scanin-svc-firebase-functions && GOOGLE_APPLICATION_CREDENTIALS=… node ../scanin-handbook/ops/src/oneoff/2026-10-25-iron-apply.js <plan.json>`. It refuses to run without the backup recorded in the plan, and recomputes from each event.
5. **Undo:** `./go.sh run src/oneoff/2026-10-20-devinci-iron-restore.ts --backup=<backup.json> --apply`. It deletes exactly the `iron:` events and restores the backed-up fields.

DeVinci needed more than this (ATS remap, station-2 leftovers, flatten everything to zero: `ops/src/oneoff/2026-10-06-devinci-*`, `2026-10-20-devinci-flatten.ts`). Those are site-specific records, not templates.

## 5. Report display

Since 2026-10-25 every report defaults to the DeVinci set: **line connected across gaps, no baseline / alert markers, y-axis = the sensor's UI scale (exact)**.
- The worker (`displayOptions()` in `scanin-svc-reports` `prepareReportDataV2.js`) and the report editor use the same defaults.
- Existing configs were set by `ops/src/oneoff/2026-10-25-report-display-defaults.ts`.
- A report can still opt out per toggle in the editor ("תצוגת גרפים").

To send a one-off copy without touching the client's config: `ops/src/oneoff/2026-10-24-send-rep141-to-hillel.ts` (temp copy → orchestrator `/run-report/<id>` → delete) is the pattern. Sensor-report PDFs are not stored, so there's no link to share later.

## Site log

| Site | Date | Before → after (MA % of prism samples, 12 months) | Notes |
|---|---|---|---|
| מגדל דה וינצי דרום | 10-06 → 10-23 | — → 85 % | remap + flatten + continuity events + recompute |
| SAVYON LIVING | 2026-10-25 | 17 % → 89 % | recompute. Prism "3": 5.8 m eras flip back and forth, iron plan unsafe → Nathan |
| SAVYON OFFICE | 2026-10-25 | 63 % → 90 % | recompute |
| NEVIIM 61 | 2026-10-25 | 42 % → 91 % | recompute |
| MERCANTIL | 2026-10-25 | 69 % → 93 % | recompute |
| NAVON | 2026-10-25 | 57 % (34 % recomputable) | **held**: dry-run has drift re-seeds at giant levels (−2720, −1289, −1979, −3455 mm). Prisms "23", "24" ironed (Nathan-approved); the rest needs a review first |
