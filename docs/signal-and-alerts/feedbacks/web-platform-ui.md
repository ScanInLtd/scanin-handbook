# Feedback — `scanin-web-platform`: Signal & Alerts UI (Phase 1 + Phase 3)

_Date: 2026-10-04_
_Tasks: UI-1.1, UI-1.2, UI-1.4, UI-3.1 … UI-3.8 (per [`tasks.md`](../tasks.md) §2)_
_Commit: `f01dcf7` on `main` (local, not pushed yet) — 44 files, +1,517 / −3,448_

## Preview channel

**https://new-scanin-ui--signal-ui-40juh2g4.web.app** (expires 2026-10-18)

- Built with Node 12 (`ng build --configuration production`), deployed with Node 20 via
  `firebase hosting:channel:deploy signal-ui --expires 14d --only new-scanin-ui`.
- The live channel (`new-scanin-ui.web.app`) is untouched.
- Build passes with only the pre-existing bundle-budget warnings.

---

## What changed

### UI-1.1 — "Set new baseline" replaces all initial-value editing

New pieces:

| File | Role |
|---|---|
| `src/app/services/baseline.service.ts` | `listBaselineEvents()` (live), `setBaseline()` → callable |
| `src/app/dialogs/set-baseline-dialog/*` | The dialog: reason / time (default now or preset) / note / optional manual initial per axis (empty = server median; placeholders show current values) |

Entry points:

- **Sidebar "Initial Value" panel** (`sidebar-elements/initial-value/*`) — values are now
  **read-only**, with a "Set New Baseline" button (admin) and the full baseline-event
  history (reason, by, time, note, initial; `migration` events dimmed).
- **Chart context menu** (`sensor-chart-main/context-menu/*`) — "Set New Baseline…"
  (admin-only) opens the dialog with the clicked point's time preset. The old
  "Set Initial Value" direct write is gone.

Removed direct writes:

- `updateInitialValue` / `updateInitialValues` deleted from `new-line-chart/sensor-data.service.ts`.
- Group **bulk settings** dialog: initial-value input removed; current baseline shown read-only.
- Legacy compare-page chart (`charts/line-chart`): its point-click → set-initial-value hook removed.
- `dialogs/set-initial-value-dialog/*` **deleted**.

### UI-1.2 — Baseline-event markers

- `src/app/shared/chart-baseline-markers.ts`: shared Chart.js afterDraw helper — dashed
  purple vertical line + flag label (`⚑ reason · date · user`) per event; labels stagger
  to avoid overlap; `migration` hidden by default.
- Wired into both **default-chart** and **prism-chart**. Events stream live from
  `work-sensors/{id}/baseline-events` (subscription in `sensor-cmp`).
- Full details (incl. note) are in the sidebar history list — no canvas hover tooltip.

### UI-1.4 — Suspect levels in threshold settings

- `shared/shared-status-types/shared-types.ts`: `AxisThresholds` gains optional
  `instant` / `suspect {jump, abs}` / `rate`; `SUSPECT_JUMP_DEFAULTS` (tilt 1°, crack 5 mm,
  prism 100 mm) + `getSuspectJumpDefault()`.
- `dialogs/edit-thresholds-v2/*`: per-axis **Suspect jump / Suspect abs** inputs
  (placeholder = per-type default), per-axis ladder validation
  `warn < alarm ≤ instant (if set) < suspect.jump` (validated against the type default when
  jump is left empty). Save merges — `instant`/`rate` on an axis are preserved; suspect is
  persisted only when entered.
- Bulk dialog: same two fields, dot-path writes (`thresholds.axes.<axis>.suspect.jump`)
  so other axis fields survive; ladder validation.
- Thresholds sidebar: suspect level shown read-only ("Suspect: jump 1 (default)").

### UI-3.1 / 3.8 — One smoothed series, honest labels

- `sensor-chart-main.processData` now carries `smooth_<axis>` (stored adjusted), `isReplay`,
  `suspect`, `suspect_reason` through both raw and adjusted arrays (and on live appends).
- **Default chart**: the main line per axis is `smooth.<axis>`, legend
  **"ממוצע 24 שעות (ללא חריגים)"**. Toggle **"הצג נתונים גולמיים"** overlays the raw samples
  faint (35% alpha, label "גולמי"). An axis with zero smooth values in the fetched range
  shows raw normally plus a note **"אין ממוצע לתקופה זו (axes)"** — no client-side gap filling.
  The old Raw/Adjusted button is renamed **"Unadjusted"** (debug; smooth hidden there since
  it's stored adjusted).
- **UI-3.8**: threshold lines render in the adjusted view on the same scale as the smooth
  series — i.e. against exactly what alerts evaluate. (The optional ±instant band for raw
  view was not included — matches the reduced task wording.)

### UI-3.2 / 3.3 / 3.5 — Client-side smoothing removed

- Default chart: `showMovingAverage`, `maWindowHours`, `maOutlierPercent`,
  `calculateMovingAverageData`, `calculateFilteredAverage`, MA settings popup — gone.
- Prism chart: 48h MA + settings, `toggleSmoothing`, `smoothingLevel` — gone; line
  `tension: 0` (straight lines).
- EMA: `fetchEmaData` / `ema-log` fetch and overlay removed from `sensor-chart-main` and
  `default-chart`; the whole EMA sidebar panel + recalc UI + meta chip removed from
  `sensor-cmp`; `updateEmaOptions` removed from `sensor-data.service`. (`ema` data and the
  functions side untouched; `options.movingAverage` on the 3 enabled sensors is now simply
  ignored — disabling the flag/data cleanup is Phase 6.)

### UI-3.4 — new-line-chart

- **Confirmed dead**: `NewLineChartComponent` was declared in `app.module` but not
  referenced by any template or route. **Deleted** along with
  `type-specific/DefaultChart.ts`, `VibrationSensorChart.ts`, `IChartType.ts`.
  `new-line-chart/sensor-data.service.ts` remains (it's the shared data service used
  everywhere).

### UI-3.6 — Prism chart on `smooth`

- Smooth is read on the **raw axis names** (incl. `smooth.TwoDDisplacement` from FN-2.5).
- All `daily*` axes are filtered centrally in `sensor-cmp.processAxes`, so `daily::` docs
  contribute nothing to the chart; the daily/full pairing, daily label maps and
  daily-initial-value mapping were removed.
- Legacy `thresholds.axes.daily*` keys still map onto their raw-axis twin for threshold
  lines (until FN-6.3 drops the keys).
- Ranges **> 90 days**: smooth is downsampled client-side to one point per day (median).

### UI-3.7 — Replay & suspect styling

- `isReplay` samples: grey **dashed** segments on the raw series + a note above the chart
  ("נתונים משוחזרים — מסומנים בקו אפור מקווקו") + tooltip suffix.
- `suspect` samples: **hidden by default** (excluded from the raw series); an admin-only
  "Suspect" debug toggle shows them as red ✕ scatter markers with `suspect_reason` in the
  tooltip. Applies to both default and prism charts.

---

## Decisions made

1. **install-sensor**: kept as-is — it writes the first `initial-value` when creating the
   sensor; the migration event (FN-1.3) + subsequent `setBaseline` calls own everything after.
2. **new-line-chart**: deleted (dead code), not kept.
3. **No daily fallback on prisms**: per Hillel's simplicity directive, `daily::` reading was
   dropped entirely (no labelled fallback series). Pre-backfill periods show raw + the
   "אין ממוצע לתקופה זו" note — same behaviour as the default chart.
4. **"Process Period" admin button kept** on the prism chart — reports still consume
   `daily::` until Phase 5.
5. **Marker tooltips**: canvas flag label (reason/date/user) + full history in the sidebar,
   instead of hover tooltips on canvas-drawn lines.
6. **Live chart updates**: with the variable dataset structure (smooth/raw/suspect per
   axis), the streaming path now does a full redraw instead of in-place dataset patching —
   simpler and correct; the 300ms slide-in animation on live points is lost.
7. **Vibration / vibration-din charts untouched** (DIN event logic is excluded by the plan);
   baseline markers also don't render there.

## Acceptance

- `grep -ri "movingAverage|ema-log|maWindowHours|smoothingLevel" src` → **zero hits**.
  No intentionally-kept hits remain.
- Production build (Node 12) passes; only pre-existing budget warnings.
- **setBaseline round-trip — PASSED** (2026-10-04, on the preview):
  - Sensor: `A085E3F365A0_1_j7pr` (loadcell, `lpKZ0eGsgnLC0d6j3oVB`, בדיקות משרד).
  - Dialog → callable → `baseline-events/jLPDwgdjlLemDQgEd85b`:
    `{reason: rebaseline, initial: {x: 633.0757, raw: -104} (server median of last 24h), by: natan.g@scanin.co.il}`.
  - `initial-value` mirrored exactly; `status.axes` and `alert_state.axes` reset to `{}`.
  - UI bugfix found by the test (commit `2954038`): the dialog now **omits `time`
    when left at "now" (±5 min)** so the server medians the *last* 24h — with an
    explicit time the window is the 24h *after* it, which is empty for "now".
  - Verification script: handbook `ops/src/oneoff/2026-10-04-setbaseline-roundtrip.ts` (`--verify`).
  - **Backend nits for FN**: (a) `raw` (a non-measurement field on loadcell samples)
    got an auto-initial — add it to `NON_AXIS_FIELDS` or restrict auto-initial to
    axes present in `thresholds.axes`/chart-axes; (b) consider falling back to the
    *previous* 24h when the after-window is empty.
- **Review fixes applied** (commit `118b994`): legend/tooltip window read from
  `smooth.w` (24 | 48, fallback 24) — "ממוצע ‹w› שעות (ללא חריגים)"; compare page
  stays raw but its series are labelled "(גולמי)".
- **Not yet verified** (waiting for the pilot backfill): pilot chart line equals
  stored `smooth` / raw toggle / suspect toggle / markers on צייטלין 12 (tilt+crack)
  and מגדל דה וינצי דרום (prism). Screenshots per type pending the same.

## Blockers for production deploy

1. **90-day smooth backfill** applied to all active projects (until then most ranges show
   the raw-fallback note instead of a smooth line).
2. **`setBaseline` callable deployed** (FN-1.2) — the dialog fails without it.
3. **Didi's approval** of the pilot sites on the preview.

## Open questions

1. Should "Set New Baseline" be offered to an **installer** role too? Currently admin-only
   everywhere (tasks.md says "admin/installer").
2. The **compare page** still plots raw via the legacy amCharts chart — switch to smooth or
   leave until retired?
3. `firestore.rules` in the web-platform repo has an uncommitted local `data-integrity`
   block (from the FN-1.5 work; rules changes were out of scope for this task) — decide
   which repo's rules copy is authoritative and commit/deploy it there.
4. UI-3.8's optional Tier-1 band (±instant around smooth when raw is shown) was skipped —
   wanted for the pilot or leave for Phase 4 (UI-4.1)?

---

## Handbook review (2026-10-04)

Approved for the preview, with the changes below.

1. **Legend window:** prisms now use a **48h** window (plan §8.1). Samples carry `smooth.w` (24 | 48) after the next functions deploy. Build the legend from it ("ממוצע 24 שעות" / "ממוצע 48 שעות") rather than hard-coding 24.
2. **No daily fallback:** OK. Instead of a fallback, the backfill will cover the full history, not just 90 days (cost is cents), so long prism ranges get `smooth` too.
3. **setBaseline is already deployed** (Phase 1, 2026-10-04 15:24Z). The test-sensor round trip can run now on `בדיקות משרד`. The recompute hook arrives with the next functions deploy.
4. **Installer:** there is no installer role, so admin only. Fix the wording in tasks.md.
5. **Compare page:** leave it on raw for now. It's a follow-up, and the screen must be labelled "גולמי".
6. **Rules:** leave the local `data-integrity` block uncommitted. It belongs to `docs/security/firestore-rules-task.md`.
7. **Tier-1 band:** Phase 4 (UI-4.1).
8. Push `f01dcf7`.
