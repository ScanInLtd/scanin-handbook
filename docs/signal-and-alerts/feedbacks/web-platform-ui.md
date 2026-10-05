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
- **Pilot data verification after the 90-day backfill — PASSED (data side, 2026-10-05)**
  via read-only `ops/src/queries/smooth-ui-verify.ts`. The charts plot the stored
  `smooth_<axis>` values verbatim, so stored-data checks ≡ chart-line checks:
  - **Tilt** נטייה 7 (צייטלין 12, `2bFvKSdK5P34K6IoV7xS`): `smooth {w:24, n≈24, q:4}`
    on every sample, 310/310 of the last 14d covered, 0 suspect; latest
    `smooth.y = 0.1311` — cross-checkable against the chart tooltip. One
    `migration` baseline event (hidden on the chart, listed dimmed in the sidebar).
  - **Crack** סדק 2 חדר שינה (`AdQzZMedF1RMtB4Hf2g4`): w=24, 330/330 covered,
    latest `smooth.x = −0.5801`.
  - **Prism** A11 (דה וינצי דרום, `iG8STFDXZWbHy4ZYC2o3`): **w=48** → legend reads
    "ממוצע 48 שעות"; `smooth.TwoDDisplacement` continuous (~1.39–1.45 mm) and
    robust — a 17 mm Height / 7.55 mm TwoD raw outlier on 10-04 15:43 left the
    smooth line unmoved. 45/49 of last 14d covered (4 gated by min-n/quarters).
  - **Suspect-rich prism**: prism "12" (`sen-prism-prism9`, JCTS_SAVYON) —
    19/27 recent samples `suspect: implausible-jump`, none smoothed; chart
    `/sites/pUeJ6MlE8HwJPV57kETZ/sec-1/sen-prism-prism9` for the
    hidden-by-default / debug-toggle demo. (`sen-prism-PRISM_JTCS_H0_12B` isn't a
    scanin-id, and no דה וינצי sensor matches "JTCS".)
  - **>90d ranges**: samples older than ~95d have no `smooth` on all checked
    sensors → the chart correctly shows raw + "אין ממוצע לתקופה זו" there until
    the full-history fill.
  - **Bug found & fixed by this verification** (commit `067df98`): adjusted raw
    TwoD was computed as `raw − initial.TwoD` (usually missing → raw magnitude
    ~6 mm drawn against smooth ~1.4 mm). Now derived as `hypot(E−E₀, N−N₀)`,
    exactly like server-side `smooth.TwoDDisplacement` (FN-2.5). Preview redeployed.
  - **Preview redeploy incident (fixed 2026-10-05 08:50):** the 08:45 channel deploy
    went out from a `dist/` with no `index.html` (Angular wrote it after the deploy
    started), so the preview returned a 404 on every route. Rebuilt with Node 12 (same
    bundle hash `main-es2015.4b4dd2dd…`) and redeployed to channel `signal-ui` only;
    preview returns 200 again. Live was not touched (still the 2026-09-24 release).
- **Visual verification + screenshots (tilt / crack / prism, raw on+off)**: pending,
  Hillel on the preview (login required). Charts:
  - Tilt נטייה 7: `/sites/oBcqejjRiLRIFhG2UzPI/sec-3/2bFvKSdK5P34K6IoV7xS`
  - Crack סדק 2 חדר שינה: `/sites/oBcqejjRiLRIFhG2UzPI/sec-1/AdQzZMedF1RMtB4Hf2g4`
  - Prism A11: `/sites/hmPh7Hg2fjTc9GyNRDYO/sec-9/iG8STFDXZWbHy4ZYC2o3`
  - Suspect-rich prism "12": `/sites/pUeJ6MlE8HwJPV57kETZ/sec-1/sen-prism-prism9`
  - >90d check: use tilt/crack (A11 has only ~54d of history).
  - Short links work too: `/s/<sensorDocId>` (route `s/:sensorDocId`), e.g. `/s/sen-prism-prism9`.

### Preview round 2: one axis at a time + event markers (2026-10-05)

Commit `1149c38` (web-platform). Built on Node 12, `dist/new-scanin-ui/index.html`
checked before deploying, redeployed to channel `signal-ui` only (bundle
`main-es2015.1545af64…`, expires 2026-10-19). Live not touched.

**1. One axis at a time** (sensor page default chart + prism chart; compare, groups
and vibration charts untouched)
- Axis chips above the chart. Only the selected axis is drawn: smooth + optional raw +
  that axis's thresholds + its own y-scale titled with the unit (`x (mm)`; prism
  "Settlement (mm)", "2D Displacement (mm)", …). Multi-axis overlays and per-axis
  y-scales are gone. On prisms the chips replace the 2D / X-Y-Z toggle (order:
  Settlement, 2D, X, Y; X/Y still fall back to the 2D thresholds).
- Chips list only axes that have data in the fetched range (sensors writing one axis per
  doc may have none for some); hidden when there's only one.
- Default: last choice for this sensor type (localStorage `sensorChart.axis.<type>`) →
  first axis with thresholds (prism: HeightDisplacement, else TwoDDisplacement) → first
  axis. Opening another sensor drops the previous sensor's selection.

**2. Event markers** (`src/app/shared/chart-event-markers.ts`, shared by both charts)
- **Alerts**: `alerts` where `sensor in [scanin-id, docId]` and `time` in the fetched range
  (+1 day for evaluation lag), via the existing `sensor ASC, time DESC` index. Loaded
  once per fetch in `sensor-chart-main` and passed to the chart. Checked on 30 days of
  production alerts: `alert.sensor` is the scanin-id when the sensor has one, otherwise
  the doc id (375/816 alerts). That's why both keys are queried.
  - Placed at `sampleTime` (fallback `time`) on the selected axis only (`alert.axis`;
    prism maps legacy `daily*` axes). y = `smoothValue` for confirmed alerts, else
    `actualValue`; `rawValue` in the Unadjusted view. Alerts outside the data range are
    skipped so they don't stretch the x-axis.
  - Icon by tier on a severity-coloured disc (red alarm / orange warn): ⚡ instant,
    📈 confirmed, ● legacy. Tooltip: level · tier, value · time, and the summary (link
    stripped, max 140 chars). Toggle "הצג התראות", on by default, for every user.
  - **No tiered alerts exist yet**: all 816 alerts of the last 30 days have no `tier`,
    so every marker on the preview is ● until Phase 4 drives v2 alerts. Only 60/816
    have `sampleTime`; the rest are placed at their creation `time`.
- **Suspect points**: no longer part of any line (raw or smooth). Admins see them as
  small red ✕ with `suspect_reason` in the tooltip, on by default, toggle "הצג חשודים".
  Non-admins never see them (button and dataset both gated on `isAdmin`).
- Baseline markers unchanged. Markers stay out of the legend, the threshold-visibility
  logic and the out-of-range check.

**3. Data-flow fixes made along the way** (in `sensor-chart-main`)
- **Per-axis suspect flags**: `processData` merges docs by exact timestamp, so on sensors
  that write x and y in separate docs, a suspect x-doc and a good y-doc share a row. The
  old row-level `suspect` hid both. Now `suspect_<axis>` / `suspect_reason_<axis>` are
  set only for the axes the suspect doc actually contains.
- **Baseline change dropped the smooth line**: `recalculateAdjustedData()` (runs when
  `initial-value` changes, e.g. after Set New Baseline) rebuilt rows with axis values
  only, losing `smooth_*`, `smooth_w`, `suspect` and `isReplay` until the next fetch. All
  four adjusted-data paths (fetch, baseline change, live append, manual insert) now go
  through one `toAdjustedPoint()`.

**Suggested data-flow improvements (not done, for a later round)**
1. **A per-sensor chart store** (an injectable service scoped to the sensor page) that
   owns sensor config, axes, thresholds, initial values, baseline events, alerts and the
   fetched series as observables. Today these go page → `sensor-chart-main` → chart as
   ~12 `@Input`s, and every chart re-derives state in `ngOnChanges` with key-set
   heuristics (`hasData && !hasStructural`, early returns). This is where the live-append,
   baseline-redraw and alerts-redraw edge cases come from. The sidebar (alerts list,
   thresholds, initial value) could read the same store instead of querying separately.
   The sidebar alerts list and the chart markers already run two different alert queries.
2. **Keep series per axis instead of merged rows**: `{ [axis]: { t[], raw[], smooth[],
   suspect[], replay[] } }`, built once in `processData`. This fits both sensor shapes
   (x+y in one doc, or one axis per doc) without null-filling, removes the
   exact-timestamp merge, and makes "one axis at a time" a plain lookup. `docId` per
   point also makes point deletion unambiguous.
3. **Parse the alert fields once**: `sensor` vs `sensorDocId` vs scanin-id, `time` vs
   `sampleTime`, `actualValue`/`trigger`/`smoothValue`. Do it in one adapter in
   `SensorAlertsService` instead of in each consumer.
4. **`applyRotationAdjustment` does nothing**: its `forEach` returns new objects that are
   discarded, and the facade angle arrives asynchronously after the function has already
   returned. Virtual tilts with a facade therefore show unrotated data. It should be
   fixed or removed, which needs a decision on whether facade rotation is still wanted.
5. Remove the stale `sensor-chart-main.component.{ts,html}.bak/.fix/.part` files.

**Screenshots for Didi (pending: Hillel on the preview, admin login).** Charts:
- cracktemp, axis switch: סדק דירה 13 `/sites/HrZkKNt2ztXUui81Biue/sec-3/ChnGmWGqzR1FZlY6xC0z`
- prism A11: `/sites/hmPh7Hg2fjTc9GyNRDYO/sec-9/iG8STFDXZWbHy4ZYC2o3`
- suspect-rich prism "12" as admin: `/sites/pUeJ6MlE8HwJPV57kETZ/sec-1/sen-prism-prism9`
- **Tilt with alerts: not possible right now.** The legacy alerts were archived (below), so
  no threshold alert exists until a new one fires (legacy evaluator, still live) or
  Phase 4 drives tiered alerts. Take this screenshot then; pick a sensor with
  `ops/src/queries/alert-fields.ts --days=7`. Before the archive, נטייה 6 was the example
  (screenshot from Hillel: a row of orange ● warn markers at ≈ −0.09°, all raw-dip alerts
  below an unaffected smooth line).

#### Old alerts don't match today's thresholds → legacy alerts archived (2026-10-05)

**Finding** (Hillel, on the preview). The markers on סדק דירה 13 sat far from the line and
didn't match the drawn thresholds. Read-only `ops/src/queries/sensor-alerts-vs-config.ts
--sensor=ChnGmWGqzR1FZlY6xC0z` showed three causes:
- **Thresholds changed 5× since February**: warn gap 0.5 → 1 → 1.4 → 0.4 → 1.3 → 3 today.
  Every marker was right under the thresholds of its day.
- **The initial value used by the alerts changed 5× too** (12.44 / −13.69 / −15.73 /
  15.72 / −41.62; −13.34 today, equal to the January migration value). None of these is
  in `baseline-events`, which holds only the migration: they were direct old-UI writes
  from before setBaseline existed. The marker heights are in each day's baseline frame.
  They can't be re-projected onto today's frame either, because the February raw
  (+11.64) vs today's (≈ −13.4) suggests a reinstall or sign change.
- **Legacy alerts were evaluated on raw samples.** The three 03-04 alerts were created in
  the same second (a burst of bad readings), and the smooth line ignores those. Several
  later "alerts" were garbage readings (raw 4,150,198; 47.46; −41.62).

On נטייה 6 the same pattern was visible as a row of warn markers from raw dips.

**Decision (Hillel):** move all legacy threshold alerts out of `alerts`, keeping them, so
no screen shows them. This was chosen over tagging, which would have needed a filter in
six UI screens (chart, sensor sidebar, section page, alerts center, log, timeline).

**Applied 2026-10-05 10:13 (Asia/Jerusalem)** by Hillel with
`ops/src/oneoff/2026-10-05-archive-pre-smoothing-alerts.ts --apply`.
- Scope: `type == "threshold"`, no `subType`, no `tier`, `time` < 2026-10-05 10:13:37.
- Moved **13,947** alerts (2025-12-12 → 2026-10-05 10:00) to `alerts-archive/{same id}`,
  with `archivedAt`, `archiveReason: "pre-smoothing-raw"` and `archivedBy` added. That was
  27,894 writes: copy first, then delete.
- Stayed in `alerts`: **2,651** = 2,650 DIN vibration alerts (correctly evaluated on peak
  velocity) + 1 `subType: test`.
- Busiest sites: `ge8lO1KCbxU4RnpgL7xs` 8,165, `pUeJ6MlE8HwJPV57kETZ` 2,528,
  `EZFDysHMoQQTQDeH5G25` 1,175, דה וינצי דרום 662, `e7nciGjF3DwsQkLEOFKn` 462,
  צייטלין 12 352.
- Backup: `ops/out/alerts-archive-backup-2026-10-05T07-13-48-600Z.json` (gitignored, local
  only). Undo: the same script with `--undo --apply`.
- **Verified** with read-only `ops/src/queries/alerts-archive-verify.ts`:
  - `alerts` 2,651, `alerts-archive` 13,947 (all `pre-smoothing-raw`).
  - 13,947/13,947 backed-up ids are in the archive, and 0 remain in `alerts`.
  - 0 legacy threshold alerts are left before the cutoff.
- No triggers: handleAlerts and evaluateMultiSensorRules run on alerts *onCreate* only,
  and nothing listens on `alerts-archive`. No reader of `alerts` was found in
  functions, reports or watchdog. The UI readers simply stop seeing these docs.

**Not changed by the archive:**
- **New legacy alerts keep coming.** The raw-based `checkThresholds` path is still live
  until Phase 4 drives tiered alerts. These are the alerts users receive on WhatsApp,
  so they show normally. (Re-running the script after Phase 4 was the original idea;
  see the follow-up below — current decision is to let them accumulate.)
- **Sensor status is untouched.** E.g. נטייה 6 is red because of
  `work-sensors/{id}.status.axes`, not because of alert docs.

**Follow-up the same day: were real alerts archived too? Decision: keep the archive.**
- On נטייה 6 the y **smooth** line itself crosses warn (−0.08) and then alarm (−0.1), and
  the sensor status is ALARM on y. So the archive also removed some real exceedances, not
  just raw noise. (A tooltip that looked like a surviving alert was the alarm **threshold
  line's** tooltip, "alarm −0.100". No alert markers are left on that chart.)
- Considered: undo the archive and classify markers in the UI instead (smooth-confirmed →
  normal, raw-only → faded/hidden, with thresholds and baseline at alert time in the
  tooltip). A read-only measurement for this,
  `ops/src/queries/archived-alerts-vs-smooth.ts`, was written but stopped before it
  finished, so there are no numbers yet.
- **Decision (Hillel): keep the archive and let alerts accumulate from now on.**
  - From the cutoff on, every alert in `alerts` comes from the current thresholds and
    baseline, so the markers match the drawn lines. After Phase 4 they're smooth-based
    and land on the line.
  - The current state isn't lost: sensor status (e.g. נטייה 6 y ALARM) lives on the sensor
    doc. Legacy alerts fire only on level transitions, so a sensor that stays in alarm
    produces no new alert.
- **Consequences to keep in mind:**
  - **Alert history before 2026-10-05 10:13:37 (Asia/Jerusalem) is not in any UI screen**
    (alerts center, log, timeline, sensor sidebar, chart). It lives in
    **`alerts-archive`** (`archiveReason: "pre-smoothing-raw"`, same doc ids and fields
    as the originals) and in the local backup
    `ops/out/alerts-archive-backup-2026-10-05T07-13-48-600Z.json`. Questions like "what
    was sent in August?" need an ops query on `alerts-archive`.
  - Until Phase 4 the raw-based evaluator keeps producing alerts, so raw-dip markers
    (נטייה 6 had 25 in 30 days) will gradually come back on the chart, at least under the
    current thresholds. Option, not done: show only tiered alerts on the chart until
    Phase 4 (open question 8).
  - Do **not** re-run the archive script casually. A second run moves everything created
    since the cutoff. `--undo` restores all 13,947 if the decision changes.

**Findings for FN (functions) from the alert census** (`ops/src/queries/alert-fields.ts`,
`alerts-census.ts`):
1. **`siteName` / `sectionName` are "Unknown Site" / "Unknown Section" on every alert.**
   `createAlertObject` reads `location.siteName`, which isn't on the location object. The
   names should be resolved from `projects` / `sections` when the alert is built. This
   matters for the alerts center, log and message texts.
2. **`alert.sensor` is the scanin-id, or the doc id when the sensor has none** (375/816 in
   30 days). Consumers must query both. Suggestion: always also write `sensorDocId`
   (already present) and query by it. Needs an index `sensorDocId ASC, time DESC`, which
   the sidebar list already uses.
3. **Only 60/816 recent alerts had `sampleTime`.** Alerts without it are placed at their
   creation time. This is fine for live data and wrong for backfills/replays.
4. **Initial-value changes made outside `setBaseline` leave no trace.** Old UI paths
   still write `initial-value` directly, or did until recently. Every baseline change
   should go through `setBaseline` so `baseline-events` is complete (see UI open
   question 5).

## Blockers for production deploy

1. ~~**90-day smooth backfill** applied to all active projects~~: done (pilot + all active
   projects). The full-history fill is still to come, so ranges older than ~90 days show raw
   plus "אין ממוצע לתקופה זו".
2. ~~**`setBaseline` callable deployed** (FN-1.2)~~: done (Phase 1, 2026-10-04); the
   round trip was verified.
3. **Didi's approval** of the preview, now including round 2 (one axis at a time + event
   markers, commit `1149c38`). Screenshots pending (see above).

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
5. **Remaining direct `initial-value` writers in the UI** (old initial-value editors,
   context-menu "set as initial"): should they all be routed through `setBaseline` so every
   baseline change gets a `baseline-events` record? This needs an audit of the writers.
6. **Facade rotation for virtual tilts** (`applyRotationAdjustment`) does nothing today.
   Should it be fixed or removed?
7. Alert markers after Phase 4: if thresholds or baseline change after an alert, its
   marker height is in the old frame again. Store the threshold and baseline on the alert
   (already done on v2 alerts) and dim markers whose config differs from today's?
8. Until Phase 4: should the chart show **only tiered alerts** (a one-line filter), so the
   raw-based legacy alerts that keep arriving don't clutter it? The sidebar and alert
   lists would still show them, since they're what users receive.
9. Should admins be able to see archived (pre-2026-10-05) alerts in the UI, e.g. an
   "archive" toggle on the sensor page reading `alerts-archive`? Today that history needs
   an ops query.

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
