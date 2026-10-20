# Task B2 — Maccabi Yafo demo report to 15.10.26 with ~3 mm settlement

_From: Hillel, 2026-10-20. Plan: [`../2026-10-20-reports-and-data.md`](../2026-10-20-reports-and-data.md) §3 B2. Repo: `scanin-tool-data-replay` (**not a git repo**: back up any file before editing it). Dry-run first; **writes need Hillel's approval**._

## Context
- **מכבי יפו מגרש 101** (`e39vIWXDt7L0peeTW81q`) is a **demo site**: all its data is generated, from time to time, with the gap-fill runbook (`docs/prism-gap-fill-runbook.md`, scripts `gap-report.js`, `gap-backup.js`, `gap-fill.js`, `gap-verify.js`, `lib/gapfill.js`).
- **Report REP136** (`ReportConfig/QpaWmsa4k2uOA1TjmVBN`, "מכבי יפו - תל אביב") is one group, "קבוצה צפונית" = **R11 `ez7QOIidMYCpkqPzqvjE`, R12 `mCPL5VROtwlc8by0DFTj`, R13 `zoHkA64eoO1BKsdL5Kr4`, R14 `6stWmfxjiH3VvBjJ4Fnr`, R15 `WsnJcTZnVYHdFFFyqOy9`**. Its period is now 2026-07-02 → 09-23.
- **State on 2026-10-20:**
  - R11–R15 have untagged samples from ~05-20 until R13/R14 06-04, R12 06-23, R15 07-23, R11 08-11;
  - after that, generated (`isReplay`) samples up to **2026-09-23**;
  - Height change start → end ≈ 0 (the runbook's "calm site ±2 mm" rule).
- **No `smooth` (MA) on any of it.** The MA deliberately skips `isReplay` / `source: replay` samples (`scanin-svc-firebase-functions` `smoothing.ts` `filterWindow`, `recomputeSmoothing.ts`). Since reports (v2) draw the MA as the main line, a report on replay-only data is empty.

## Goal
Hillel needs REP136 from the **site's start to 2026-10-15**, looking like real data, showing **≈ 3 mm settlement** (Height going down about 3 mm from start to end) on the group's prisms, with a smooth, realistic MA line.

## Decisions (Hillel, 2026-10-20)
- The demo must look like **real data**: no dashed segments, no "נתונים משוחזרים" footnote.
- Base it on the recent backfills (same copy-&-follow method and noise character).
- **Tagging, to confirm with Hillel before `--apply`:** tag generated docs for this site as `isWorked: true, source: 'worked'` **instead of** `isReplay: true` (Hillel: not "demo"). Then the MA, the UI and reports treat them as normal data, with no functions change. Alerts don't fire on them: `checkThresholds` skips samples older than 48h, and every generated sample is ≤ 2026-10-15. Docs stay identifiable through `isWorked: true`.

## What to build (scanin-tool-data-replay)
1. **`--trend=<axis>:<mm>`** in `gap-fill.js` (e.g. `--trend=HeightDisplacement:-3`).
   - The trend is **0 up to each prism's last untagged sample**, then linear (or gently eased, document which) to `<mm>` at `--end`, **relative to the baseline** the fill already uses.
   - The copy-&-follow shape + noise ride on top. Keep the derived fields consistent (TwoD / ThreeD / absolute coords) and 1-decimal precision, as the runbook requires.
   - The ±max-dev clamp must follow the trend: it applies to the deviation from baseline + trend, not from baseline.
2. **`--tag=worked|replay`** (default `replay`, i.e. today's behavior). `worked` writes `isWorked: true, source: 'worked'` and no `isReplay`.
   - On `--apply`, the fill must replace prior generated docs in the window **of either tag** (`isReplay` or `isWorked`), never untagged ones.
3. **`gap-verify.js`:**
   - accept the trend: smoothness checks on the detrended series;
   - report the total Height change from the first to the last 14 days (target ≈ −3 mm, ±0.5).

## Steps
1. `gap-report.js e39vIWXDt7L0peeTW81q`: confirm the state above.
2. Backup: `gap-backup.js --project=e39vIWXDt7L0peeTW81q --names=R11,R12,R13,R14,R15`.
3. **Dry-run:** `gap-fill.js --project=e39vIWXDt7L0peeTW81q --names=R11,R12,R13,R14,R15 --start=<each prism's last untagged sample, i.e. the default> --end=2026-10-15T23:59 --trend=HeightDisplacement:-3 --tag=worked`. This regenerates the whole generated window (the existing `isReplay` docs after the untagged ones get replaced).
4. **Report the dry-run to Hillel and STOP:**
   - per prism: slots to write, docs to replace, simulated Height start/end, max day-to-day jump (detrended), E/N spans;
   - a small chart (HTML or PNG) of simulated Height for the 5 prisms.
5. After approval: `--apply`, then **MA backfill**, from `scanin-svc-firebase-functions`:
   `node scripts/recompute-smoothing.js --project=e39vIWXDt7L0peeTW81q --days=all --apply`
   (needs `npm run build`; env per the handbook `AGENTS.md` / `DEV-ENV-ISOLATION.md`). Check the coverage it prints (target > 90% per prism).
6. `gap-verify.js` with the trend → pass.
7. **Render the report locally for Hillel**, without emailing (`scanin-svc-reports`): set the period to site start → 2026-10-15 in a copy of the config, or ask Hillel to change REP136's period in the UI, then `node scripts/entry-points/render-only.js QpaWmsa4k2uOA1TjmVBN`. Send Hillel the PDF path. **Don't trigger the real report** (it emails).
8. Update `docs/prism-gap-fill-runbook.md` with `--trend` / `--tag` and this run as a worked example.
9. Feedback: `../scanin-handbook/docs/work-plan/feedbacks/B2-maccabi-demo.md`.

## Rules
- Only R11–R15 of this project. Never touch untagged docs, never touch other projects.
- No `--apply` (fill or recompute) before Hillel approves the dry-run.
- `scanin-tool-data-replay` has no git: copy `gap-fill.js`, `gap-verify.js` and `lib/gapfill.js` to `*.bak-2026-10-20` before editing.
