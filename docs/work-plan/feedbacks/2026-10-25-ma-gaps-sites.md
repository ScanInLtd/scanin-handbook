# MA gaps on SAVYON / NEVIIM 61 / MERCANTIL + report display defaults (2026-10-25)

_Asked by Nathan via Hillel: start with סביון משרדים, סביון מגורים, נביאים 61, בנק מרכנתיל, then every site whose prisms lack the MA over the last year. Runbook written from it: [`../../ops/prism-ma-gaps-runbook.md`](../../ops/prism-ma-gaps-runbook.md)._

## 1. Diagnosis

Read-only `ops/src/analysis/ma-gaps.ts` (same gates as functions `smoothing.ts`), 12 months, active prisms. Most of the missing MA was **never computed**: the data is fine, but the fleet backfill covered only 90 days (from mid-July), and older history was computed only for prisms someone had touched by hand. Within one site, those prisms were at 90 %+ and the rest at 0–15 %.

## 2. Full-history recompute — applied

`recompute-smoothing.js --project=<4 sites> --days=all --type=prism`:
- **Dry-run:** only `chain-start` re-seeds (105), no drift.
- **Apply:** 35 prisms, **73,111 samples written**, 2.5 min, ≈ $0.27. `checkThresholds` is `onCreate`, so no alerts / WhatsApp.

| Site | MA before | MA after | Report holes ≥24h before → after (prism-days) |
|---|---|---|---|
| SAVYON LIVING | 17 % | **89 %** | 4,402 → 813 |
| SAVYON OFFICE | 63 % | **90 %** | 671 → 169 |
| NEVIIM 61 | 42 % | **91 %** | 1,143 → 220 |
| MERCANTIL | 69 % | **93 %** | 443 → 221 |

The rest is sparse data (min-n / day-quarters, 5–8 %) and real data gaps (no readings: 528–2,585 prism-days per site). A recompute can't fill those; the reports bridge them (now the default, §4).

## 3. Ironing (Nathan's 2026-10-20 approvals)

New generic tools:
- `ops/src/oneoff/2026-10-25-iron-approved.ts` (plan, simulation, backup);
- `2026-10-25-iron-apply.js` (reason `iron` → continuity, recompute from each event);
- undo = `2026-10-20-devinci-iron-restore.ts`.

- **Applied (plan clean, today's level ≈ 0):** NAVON "23" (2 events: 07-09 Z+1752, 08-26 X+153/Y+169/Z+2642) and NAVON "24" (08-26 X−8825/Y−2776/Z−2737). Backup `ops/out/devinci-iron-backup-2026-10-25T09-55-50-609Z.json`; applied log `ops/out/iron-approved-plan-2026-10-25T09-55-50-613Z-applied.json`.
- **NOT applied, back to Nathan:** JAFFA_68 "1", "2", NAVON "9", "18", SAVYON LIVING "3". The plan's safety check shows **today's level would end far from zero** (e.g. JAFFA "1" Z +3,661 mm, SAVYON "3" X −8,870 mm). These prisms keep flipping between two levels after the review dates: JAFFA "1" is back at +1,832 mm since 23.04, and SAVYON "3" has had the same +8,872 / +2,716 era since 24.05 → 29.07 and again from 27.08. That's the "two prisms in one sensor / wrong point" pattern (like Nathan's "unsure" ones), a mapping question, not ironing.
- **Other giant eras on the ironed prisms** (listed, not touched): NAVON "23" 09-24 Z−2666, 10-12 Z+1957; NAVON "24" 09-08 / 09-22 / 09-23 (±700, ATS-6 bad-frame period).
- **Not a step:** the "station-wide 10-12 jump" the step inventory shows on SAVYON / NAVON / JAFFA. That's the ATS-6 bad frames 23.09 → 12.10, already `suspect: implausible-jump` and excluded from the MA.

## 4. Report display defaults = the DeVinci set — live

Every report now defaults to: **line connected across gaps, no baseline / alert markers, y-axis = the sensor's UI scale (exact)**.
- **Reports worker** `1270700` (`displayOptions()`), revision `reports-worker-00124-fay`, 100 % traffic. It also ships the other session's email-status commits `90e8b95` / `df42624`, which were already on `00122`.
- **Report editor** `b80852b`, live bundle `main-es2015.29599ce0`: new reports start with these, a missing field loads as them, and the option texts say "Default: on/off" accordingly.
- **Existing configs:** all 24 non-health `ReportConfig` docs set explicitly by `ops/src/oneoff/2026-10-25-report-display-defaults.ts` (23 changed; backup `ops/out/report-display-defaults-backup-2026-10-25T10-06-21-127Z.json`, `--undo`).
- **Check:** a local render of NEVIIM 61 (`render-only.js ihihPiydjLVRQaBYIk6S`) logs `🎨 display: {connectGaps:true, …}`. The group chart is connected, without markers, on the ±16 mm UI scale.

## 5. Fleet scan (all 11 active projects with prisms)

| Project | MA % | Recomputable % | Note |
|---|---|---|---|
| NAVON | 57 | **34** | **held**: the recompute dry-run has drift re-seeds at giant levels (ref −2720, −1289, −1979, −3455 mm), so the MA would follow wrong eras. Needs the giant-step review first |
| JTCS_RKL_R2 | 61 | 6 | sparse (min-n 23 %, 448 samples in a year) |
| מכבי יפו 101 | 71 | 5 | sparse (min-n 18 %) |
| JAFFA_68 | 84 | 1 | 10 % suspect (two-prism sensors "6", "8") |
| DeVinci | 85 | 4 | done 10-23 |
| SAVYON LIVING / OFFICE / NEVIIM / MERCANTIL | 89–93 | 2 | done today |
| SHTRAUS 4, jaffa_44 | 93 | 1–2 | fine |

So after today, only NAVON has a large never-computed share, and it's blocked on its wrong-level eras.

## Open for Nathan
1. JAFFA_68 "1", "2", NAVON "9", "18", SAVYON LIVING "3": which level is the right one (two prisms in one sensor?). The approved ironing would make today's data wrong.
2. NAVON giant steps (65 steps ≥ 200 mm on 18 prisms since 2025, `ops/review/steps-big-ge8lO1KCbxU4RnpgL7xs.json`): review before the NAVON recompute.
