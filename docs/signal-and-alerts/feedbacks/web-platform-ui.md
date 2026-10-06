# Feedback — `scanin-web-platform`: Signal & Alerts UI (Phase 1 + Phase 3)

_Date: 2026-10-04_
_Tasks: UI-1.1, UI-1.2, UI-1.4, UI-3.1 … UI-3.8 (per [`tasks.md`](../tasks.md) §2)_
_Commit: `f01dcf7` on `main` — 44 files, +1,517 / −3,448_
_**LIVE since 2026-10-05 10:03Z** (`f116a70`, bundle `main-es2015.b726b3bd`) — see [Go-live](#go-live-2026-10-05)_

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

### Review round 2 implemented (2026-10-05): Q5 + Q8 + sensorDocId alert query

Commit `611be8b` (web-platform). Built on Node 12, `dist/new-scanin-ui/index.html` checked
before deploying, redeployed to channel `signal-ui` only (bundle
`main-es2015.d7cc5036…`, expires 2026-10-19). Live not touched.

**Q5: every initial-value write goes through setBaseline.** I audited every file that
references `initial-value` (17 in `src/`) and every whole-document write to
`work-sensors`.

Changed:

| Writer | Before | Now |
|---|---|---|
| Technical info → **"Auto Fix View"** (admin) | One `update()` writing `initial-value` (latest values) + `uiScale` + `thresholds.axes` | `uiScale` + `thresholds.axes` written directly first, then the baseline via **`setBaseline`** (`reason: rebaseline`, explicit `initial`, note "Auto Fix View (latest values)"). That creates an event and resets status for the new threshold axes. |
| **Storage page** → save work sensor | `update(newWorkSensor)`: the whole doc loaded earlier, including a possibly stale `initial-value` | Drops the server-owned fields **`initial-value`, `status`, `alert_state`** (`withoutServerOwnedFields`, `baseline.service.ts`). Saving an unrelated field can no longer revert a newer baseline or the evaluator state. |
| **Install sensor** → save an **existing** sensor | `set({...form}, {merge:true})` wrote the form copy of `initial-value`. After a type change the form resets it to zeros. | Initial values are written **only when the sensor is created** (that first write stays, as agreed). For an existing sensor the inputs are read-only with the hint "use Set New Baseline", and the save drops `initial-value` / `status` / `alert_state`. |
| Install sensor → **rename** (new scanin-id ⇒ new doc id; data-log copied, old doc deleted) | The new doc got the form's initial values, and **`baseline-events` were not copied** (history lost) | The new doc takes the current doc's `initial-value` / `status` / `alert_state` unchanged, and **`baseline-events` are copied** with the same event ids. |

Already routed or read-only since round 1 (verified, no change): context menu "Set New
Baseline" (dialog → callable); sensor-group bulk dialog (baseline shown read-only);
legacy amCharts `line-chart` (initial-value edit removed); `sensor-data.service`
`updateInitialValue(s)` (removed); sidebar Initial Value panel (read-only + dialog).

Read-only uses, no write: `sensor-cmp`, `section-cmp`, `sensor-group-view`,
`settings-sensor-status`, `day-report`, `latest-read`, `manual-sample-dialog`,
`edit-thresholds` (keys only), `sensor-details` (its form never includes
`initial-value`). Creation-only writes, allowed: install-sensor new sensor, storage
`newWorkSensor` template, `sensor.service.createSensor`.

Out of scope: other repos (e.g. `scanin-tool-sensor-clone`, maintenance scripts) and the
functions' own writers (`setBaseline`, migration).

**Found during the audit, not fixed (install-sensor save path), for a later round:**
- Re-saving an existing sensor also writes `thresholds = sensorType.defaultThreshold`
  (merge), which may add or overwrite threshold keys, and resets `date-installed` to now.
- The rename path copies the whole data-log in **one batch**. Above 500 docs the commit
  fails, and the old doc then isn't deleted (both docs remain).

**Q8: chart markers show only tiered alerts until Phase 4.** `sensor-chart-main` filters
the loaded alerts to `alert.tier` present. The sidebar Recent Alerts and the alert
lists still show all alerts. The button tooltip now says old alerts appear in the alert
list only. Effect today: no markers anywhere, because no tiered alerts exist yet.

**Alert-marker query by `sensorDocId`.** Primary `sensorDocId == id` + time range, with
the fallback `sensor in [scanin-id, docId]` for old docs. Both run in parallel and are
merged by alert id. If either fails (e.g. an index still building), the other's results
are kept. Read-only check: the `sensorDocId ASC, time DESC` range query already works in
production.

**Answers recorded (handbook review round 2):** 5 done (above). 6 facade rotation is out
of scope, left as is. 7 later, after v2: dim markers from an old config (v2 alerts carry
thresholds and baseline). 8 done (above). 9 no archive toggle for now.

**Heads-up, next round (no work yet):** the axis registry
`docs/signal-and-alerts/axes.md`. The axis chips will read labels, units and order from
it instead of `chart-axes` (and the prism label map / `AXIS_ORDER` in
`prism-chart.component.ts`).

### Q10 fixed: install-sensor save path (2026-10-05)

Review round 2 was approved. Commit `e4b6440` (web-platform). Built on Node 12,
`index.html` checked before deploying, redeployed to channel `signal-ui` only (bundle
`main-es2015.3d8b7b71…`). Live not touched.

1. **Existing sensor: thresholds and `date-installed` are never written.** The
   `defaultThreshold` merge and the `date-installed = now` reset now happen only when the
   sensor is **created**. The save of an existing sensor drops `thresholds` and
   `date-installed`, along with the server-owned `initial-value` / `status` /
   `alert_state` from round 2. Thresholds change only via the thresholds editor. A
   **renamed** doc takes all five fields unchanged from the current doc.
2. **Rename: chunked, safe copy** (`src/app/pages/install-sensor/copy-sensor-subcollections.ts`).
   - `data-log`, then `baseline-events`, copied in **sequential batches of ≤ 400**
     (paginated by document id). Progress is shown under Submit: "Copying data-log: N
     docs…".
   - **Same doc ids** in the new doc, so a retry after a failure overwrites instead of
     duplicating. The old code created random ids.
   - **The old doc is deleted only after every chunk committed.** On failure the copy
     stops, the old doc is kept, and the form plus a snackbar show "Rename stopped —
     copied X samples and Y baseline events to <new>. The old sensor doc <old> was kept.
     Retrying is safe." The form isn't reset.
   - Behaviour change: the old code deleted the old doc only when its data-log was
     non-empty, so renaming a sensor with no samples left both docs. Now the old doc is
     deleted after a successful copy, even an empty one.
   - Unchanged (out of scope): deleting the old doc still leaves its subcollections
     orphaned. Firestore client deletes don't cascade (see the Hebrew comment in the code).
   - The function is framework-free, so the ops test runs **the same file** with
     firebase-admin.
3. **Test on בדיקות משרד** (`ops/src/oneoff/2026-10-05-test-rename-copy.ts`). It never
   touches the real sensor. It copies to a temporary doc `<id>__rename-test-20261005`,
   verifies, then deletes the temporary doc.
   - Sensor: `lpKZ0eGsgnLC0d6j3oVB` (A085E3F365A0_1_j7pr), **5,148 samples + 1 baseline
     event** → 13 chunks.
   - Steps: (1) simulated failure on the 2nd commit: expect a stop with 400 reported
     copied, the target holding exactly 400, and the source unchanged. (2) Retry → full
     copy: reported counts == source, target counts == source (no duplicates from the
     retry), 3 docs spot-checked identical with the same ids. (3) Delete the temporary copy
     and verify it's gone.
   - **Result: PASSED** (run by Hillel, 2026-10-05):
     - (1) the failure stopped the copy and reported 400 data-log docs copied; the target
       held exactly 400; the source was unchanged.
     - (2) the retry copied `{"data-log":5148,"baseline-events":1}` in 13.1s; target
       counts == source (no duplicates); 3 docs identical with the same ids; the source
       was still unchanged.
     - (3) deleted 5,149 temporary docs; the temporary copy and its parent are gone.

### Axis registry X2: the sensor page reads the registry (2026-10-05)

Commit `80bf2f4` (web-platform). Built on Node 12 (clean, no new warnings), `index.html`
checked before deploying, redeployed to channel `signal-ui` only (bundle
`main-es2015.9e2963be…`). Live not touched. Spec: `axes.md` §4, §4.5, §5.

**One module, used everywhere:** `src/app/shared/axis-registry.ts` (framework-free). It
turns the type doc plus the sensor doc into the axis list: label (Hebrew), unit, order,
chart, alertable, `suspectJump`, and whether this sensor has thresholds on the axis.
Types without `axes` (today only `inclinometer-robot`) fall back to `chart-axes`, with the
key as the label and every axis alertable (the old behaviour).

| Area | Now |
|---|---|
| **Chart tabs** (timeseries only) | Axes with `chart: true` + **any axis with thresholds on this sensor** (invariant 2), in registry `order`, labelled "label (unit)". A chip is hidden when the axis has no data in range **and** no thresholds; that's for sensors that write one axis per doc, e.g. the cracktemp `celsius` probe vs `x`/`y`. **Prism `daily*` axes are gone.** |
| **Prism chart** | The hardcoded label map and `AXIS_ORDER` are removed; labels and order come from the registry. Default tab still Height, then 2D. The context menu now reads the axis key from the dataset (it used to parse the display label). |
| **Labels / units** | Registry "label (unit)" in: y-axis title, legend, tooltips, threshold lines ("שקיעה (mm) — סף אזעקה"), alert/suspect marker tooltips, "אין ממוצע" note, sidebar status per axis, initial value, axis meanings (new `axisLabel` pipe). |
| **Threshold editor + panel** | Lists the **alertable** axes, each marked **מתריע** (gap set) / **לא מתריע**, following the toggle. A **non-alertable axis that still has thresholds** is listed **read-only** with **"עדיין מתריע — יוסר בהמשך"** and its current gaps (prism TwoD on ~165 sensors, until X4). It can't get new thresholds. **Saving now keeps every threshold the editor doesn't edit** (TwoD, legacy `daily*`). Before, the save replaced the whole `thresholds.axes` map with the editable axes only, which would have silently deleted them. |
| **Suspect placeholder** | Per axis from the registry `suspectJump` (prism 100, tilt 1, crack/cracktemp/OPKON 5). `SUSPECT_JUMP_DEFAULTS` / `getSuspectJumpDefault` are removed from the UI. The functions/reports copies of `shared-types` never had them, so there's no drift. The sensor-group bulk dialog reads the registry too. |
| **Layout per type** (§4.5) | The chart component is chosen by **`chartLayout`**: `timeseries` → prism-chart (type prism) / default-chart; `din4150` → vibration-din-chart (type vibration-din) / vibration-chart; `vibration-vf` → vibration-vf-chart. The type name only picks the variant inside a layout. The thresholds panel shows only for **`alertRule: "thresholds"`**: hidden for vibration + vibration-din (DIN 4150-3 evaluation; before, it was hidden only for vibration-din, by type name), and velocity only for vibration_vf. Missing fields → timeseries / thresholds. |
| **Vibration components** | Unchanged. They keep getting the legacy `chart-axes` data keys (`velocity`, `freqeuncy`, `type`, `axis`), with registry labels/units overlaid where the key matches (velocity, frequency). No alias for the misspelling in the new code. |

**Verified with production data, read-only.** `ops/src/queries/axis-ui-preview.ts` runs
the UI's own `axis-registry.ts` against Firestore:
- **A11** (prism): tabs שקיעה / תזוזה מזרח / תזוזה צפון / תזוזה אופקית (mm); editor
  Height, East, North = מתריע; **תזוזה אופקית = "עדיין מתריע — יוסר בהמשך" (read-only)**;
  suspect default 100. The four `daily*` thresholds are kept on save, not shown.
- **סדק דירה 13** (cracktemp): tabs פתיחת סדק (mm) / טמפרטורה (°C); editor פתיחת סדק =
  מתריע (temperature isn't alertable and has no thresholds since X1).
- **נטייה 7** (tilt): הטיה X / הטיה Y (°), both מתריע, suspect default 1.
- **gev yam** (vibration_vf): vibration-vf chart unchanged; editor מהירות (mm/s) only.
- **vib 1** (vibration-din), **VIB-H21-0** (vibration): DIN charts unchanged, data keys as
  before; threshold editor hidden.

**Misspelled `freqeuncy`: still written.** Checked with read-only
`ops/src/queries/vibration-frequency-field.ts`, the latest 200 docs per sensor:
- vibration-din (32 sensors, data up to 13 h ago): every doc with a frequency carries
  **both** `frequency` and `freqeuncy` (2,700 docs). No doc has only one of them.
- vibration_vf: both, on all 200.
- Legacy `vibration` (5 sensors): **only `freqeuncy`**, newest 2024-10-07.

So live writers still duplicate the misspelled field, and the old `vibration` history has
nothing else. `vibration-din-chart` reads only `freqeuncy` (13 places); `vibration-chart`
reads it in 4 places and falls back to it once. Suggested cleanup (not done): charts read
`frequency` (fallback only for legacy `vibration`) → the bridge stops writing `freqeuncy`
→ `chart-axes` regenerated from the registry.

**Screenshots for Didi (pending, Hillel on the preview):**
- prism tabs: A11 `/sites/hmPh7Hg2fjTc9GyNRDYO/sec-9/iG8STFDXZWbHy4ZYC2o3`
- cracktemp x + temperature tabs: סדק דירה 13 `/sites/HrZkKNt2ztXUui81Biue/sec-3/ChnGmWGqzR1FZlY6xC0z`
- threshold editor on a prism: A11 → Thresholds panel → edit (shows the read-only
  תזוזה אופקית row).

**For review:**
- ~~Prism East / North show "מתריע", but they don't alert yet~~: **resolved** with the
  per-project prism rule (next section).
- Other screens still on `chart-axes` (sensor groups, data-handling tools, calc sensors,
  legacy line chart) and the `freqeuncy` cleanup are logged as **X8** in `axes.md`. Not
  this round.

### X2 review: prism labels follow the project's `prismAxes` (2026-10-05)

X2 was approved. Commit `f116a70` (web-platform). Built on Node 12, `index.html` checked
before deploying, redeployed to channel `signal-ui` only (bundle
`main-es2015.b726b3bd…`). Live not touched.

The functions switch prism axes per project: `projects/{id}.prismAxes = 'registry'`
(E/N/H alert, TwoD doesn't), or missing (today: Height + TwoD alert, E/N don't). The
threshold panel and editor read the same field, so each label says what is actually
evaluated:

| Prism axis (gap set) | `prismAxes` missing (today) | `prismAxes: 'registry'` |
|---|---|---|
| Height | **מתריע** | **מתריע** |
| East / North | **יתריע לאחר המעבר** (editable; not alerting yet) | **מתריע** |
| TwoD (non-alertable in the registry) | **מתריע**, read-only: "לא ניתן להוסיף ספים חדשים לציר זה. הספים הקיימים עדיין פעילים." | **ספים ישנים — לא מתריע**, read-only: "ספים ישנים שאינם בשימוש — הציר אינו מתריע ולא ניתן לערוך אותם." |
| any axis without a gap | לא מתריע | לא מתריע |

- In the editor the state follows the toggle: enabling East in a pre-switch project shows
  "יתריע לאחר המעבר", not "מתריע".
- **Non-prism types unchanged.** A non-alertable axis that still has thresholds keeps
  "עדיין מתריע — יוסר בהמשך".
- One function decides it: `axisAlertState(axis, { prismAxes }, hasGap)` in
  `src/app/shared/axis-registry.ts`. The pre-switch prism rule is the explicit list
  `PRISM_LEGACY_ALERTING_AXES = [Height, TwoD]`, mirroring the functions' current filter.
- **Project doc:** for prism sensors the sensor page subscribes to `projects/{site}`
  live, so a per-project flip updates the labels without a reload. It reads the doc
  directly because the data-manager project cache only holds the user's own projects
  (`users array-contains uid`), which an admin viewing another project would miss.
  Until the doc arrives, it assumes today's rule.
- **Verified** with the UI's own function:
  - Production (`ops/src/queries/axis-ui-preview.ts`, now applies the project rule):
    A11 and prism "12" (no project has `prismAxes` yet) → Height מתריע · East/North
    יתריע לאחר המעבר · TwoD מתריע (read-only). cracktemp unchanged.
  - The `'registry'` branch, exercised offline on A11's axes → Height/East/North מתריע ·
    TwoD ספים ישנים — לא מתריע (read-only); East toggled off → לא מתריע.

Screenshot for Didi (pending): A11 → Thresholds panel + editor (today's rule; shows the
blue "יתריע לאחר המעבר" and the read-only TwoD row).

## Go-live (2026-10-05)

- **Live since 2026-10-05 10:03Z.** Didi approved, and the preview channel `signal-ui`
  (`f116a70`, bundle `main-es2015.b726b3bd`) was cloned to live (`new-scanin-ui.web.app`)
  by Hillel. One minute earlier (10:02Z) all 22 active projects were flipped to
  `alerting: v2`, so tiered alerts now start arriving on the charts.
- **Rollback:** clone the previous live version **`070ffaf9eb5e1013`** (the 2026-09-24
  release) back to live.
- **`main` pushed** to `origin` (`067df98..f116a70`, the 5 commits `1149c38`,
  `611be8b`, `e4b6440`, `80bf2f4`, `f116a70`). The local `firestore.rules` change is
  still uncommitted and was not pushed; it belongs to `docs/security/firestore-rules-task.md`.
- **What went live, in short:**
  - the smooth line by default, with a raw toggle
  - baseline events (setBaseline only, with markers on the chart)
  - suspect samples as ✕ markers (admins only)
  - one axis at a time, with tabs read from the axis registry
  - tiered-only alert markers
  - the threshold editor showing "מתריע" / "לא מתריע", following each project's
    `prismAxes` rule
  - safer install-sensor save and rename
- **After go-live, worth watching:**
  - The first tiered (⚡/📈) alert markers on the charts. There are none so far: the old
    alerts were archived, and v2 started at 10:02Z.
  - The prism threshold labels on the projects already on `prismAxes: registry`
    (דה וינצי דרום, SAVYON LIVING + OFFICE) vs those still on H + TwoD.

**Next rounds (heads-up, no work yet):**
1. **Phase 4 UI**:
   - UI-4.1: an instant-gap field per axis in the threshold editor, plus a noise-floor hint.
   - UI-4.2: tier icons and values in the alert lists and the sensor sidebar.
2. **X8**: the `freqeuncy` cleanup (charts read `frequency` → the bridge stops writing
   the misspelling), the remaining `chart-axes` screens (sensor groups, data tools, calc
   sensors, legacy line chart), and regenerating `chart-axes` from the registry.

## Blockers for production deploy

_All cleared — live since 2026-10-05 10:03Z (see Go-live above)._

1. ~~**90-day smooth backfill** applied to all active projects~~: done (pilot + all active
   projects). The full-history fill is still to come, so ranges older than ~90 days show raw
   plus "אין ממוצע לתקופה זו".
2. ~~**`setBaseline` callable deployed** (FN-1.2)~~: done (Phase 1, 2026-10-04); the
   round trip was verified.
3. ~~**Didi's approval** of the preview~~: approved 2026-10-05; cloned to live 10:03Z.

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
5. ~~Route every direct `initial-value` writer through `setBaseline`?~~ **Yes → done**
   (`611be8b`, see "Review round 2 implemented").
6. ~~Facade rotation for virtual tilts~~: **out of scope this round**, left as is.
7. ~~Dim markers from an old config?~~ **Later, after v2** (v2 alerts carry thresholds and
   baseline).
8. ~~Chart shows only tiered alerts until Phase 4?~~ **Yes → done** (`611be8b`).
9. ~~Archive toggle?~~ **No, not for now.**
10. ~~Install-sensor save path (defaultThreshold merge, date-installed reset, single-batch
    rename copy)~~: **fixed** (`e4b6440`, see "Q10 fixed").

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

---

## UI-1.3 — /integrity notices page + confirm-point flow (2026-10-06)

**Preview:** https://new-scanin-ui--signal-ui-40juh2g4.web.app/integrity (expires 2026-10-20)
**Commit:** `982a696` on `main`. Preview only — production deploy awaits approval.

### What was built

- **Routes** `/integrity` + `/integrity/:noticeId`, new `AdminGuard`
  (`src/app/guards/admin.guard.ts`): not logged in → `/login?returnUrl=…` — the login page
  now honors `returnUrl` (all three sign-in paths), so a WhatsApp link opened on a phone
  continues to the notice after sign-in; logged-in non-admin → `/unauthorized`.
- **List** (`pages/integrity/integrity-list.component.*`): tabs פתוחות / טופלו (open first,
  ordered by `lastSeenAt` desc), kind filter chips (emoji + Hebrew title, same wording as the
  WhatsApp messages), project dropdown, per-card: kind title, sensor · project · section
  (names resolved from Firestore), ×count, opened / last-seen times; resolved cards show
  who/when. Mobile-first, RTL, 640px max width.
- **Detail** (`integrity-detail.component.*`):
  - header with the §1 emoji+titles (🔴 קריאה חשודה, 🕒 באיחור, 📐 קפיצת מדרגה, 🆕 בהקמה,
    🧪 בדיקה), "לא נשלחה ללקוח" for suspect kinds, sensor · project / section lines, the
    numbers from `details` per kind (Δ+unit vs ref — axis label+unit read from the
    **registry `axes` map**, other jumped axes, days behind + last-measured date, step size
    since date, auto-delete date), opened / last seen / ×count;
  - **±3-day chart** of the affected axis around `details.sampleTime` (fallback lastSeenAt):
    smooth line ("ממוצע 24/48 שעות (ללא חריגים)"), raw faint, suspect samples as red ✕ with
    reason in the tooltip, baseline markers (shared helper), and a light-red vertical line at
    the event time. Built as a compact standalone Chart.js chart (one axis, fixed range)
    rather than embedding the full sensor-chart stack — decision noted below;
  - **actions** (inline confirm panel + optional note, mobile-friendly):
    - implausible-jump / out-of-range: 🔧 baseline חדש (opens the Set-Baseline dialog with
      `noticeId` + the sample time preset) · ✅ תזוזה אמיתית — אשר והתרע (`releaseSuspect`;
      the confirm text says readings return to the average and a client alert may follow per
      the alert rules) · 🗑️ תקלה — התעלם (`ignoreNotice` + note);
    - level-shift / run-common-mode: baseline + ignore only — **`releaseSuspect` rejects
      non-evaluator kinds** (`EVALUATOR_REASONS = implausible-jump|out-of-range`), so the ✅
      action is hidden there; if level-shift should be releasable, that's an FN change;
    - late-data: no actions — the "📡 לבדוק לוגר ותקשורת" hint + פתח חיישן;
    - unconfirmed-sensor: "✅ אשר נקודה" → the confirm-point dialog;
  - resolved notices: green banner with resolution (Hebrew label), who, when, note; actions hidden.
  - "פתח חיישן" → `/s/:sensorId` everywhere.
- **Confirm-point flow** (`dialogs/confirm-sensor-dialog/*`):
  - target project (required) + section selects (all projects — admin feature), change since
    the creation baseline (latest sample − initial per axis; prisms get a headline
    "+‹Δ› מ"מ (תזוזה דו-ממדית)" via hypot of E/N deltas), zero-point radio: keep creation /
    new now (= `setBaseline` reason `ats-setup`, initial omitted → server median of last 24h,
    `noticeId` passed when opened from a notice), then writes `location.site`/`section` +
    `confirmed: true`;
  - the sensor-page badge (`shared/components/unconfirmed-sensor-badge`) reworked: Hebrew
    "בהקמה — לא מתריע" + "יימחק בעוד N ימים", **7-day window** (the old copy said 60
    minutes), and the old one-click `confirmed:true` replaced by the dialog (also in the
    compact variants on the dataloggers/sensor lists). Merging into an existing sensor: not
    in this round, as specified.
- Set-Baseline dialog: optional `noticeId` in its data → passed to the callable (resolves the
  notice with 'baseline').

### Registry verification (prism labels)

The registry write is in: `devices-types/sensors/devices/prism.axes` has תזוזה X/Y/Z
(order 2/3/1), TwoD `chart:false / report:false`, `smoothingWindowHours: 48`, `axesVersion: 1`.
**But**: the web UI's chart tabs still read the legacy `chart-axes` field (which still lists
TwoD + the daily* keys — daily* filtered client-side since UI-3.6). So the new `axes` flags
do NOT drive the chart tabs yet; the notice page does use `axes` for labels/units. Options:
(a) also update legacy `chart-axes` (data-only), or (b) a small UI change to prefer the
`axes` registry (would drop TwoD from the prism chart per chart:false — which also makes the
2D/X-Y-Z toggle moot). Decide and I'll follow up.

### Open items

- Phone-width screenshots (list, suspect-notice detail, confirm-point dialog) — Hillel on
  the preview; two live late-data notices exist for the list/detail shots; a suspect-kind
  shot needs an open implausible-jump notice (or a test one).
- Production deploy after approval — then functions can switch the WhatsApp links.

### Follow-ups (2026-10-06, commits `b3571c7` + `2aaa5e5`, preview redeployed)

- **Settings dashboard card**: new admin card "Data Integrity" (`fact_check`, featured) on
  the settings dashboard → navigates to `/integrity` (top-level route, not a settings tab);
  participates in the per-user recent-interaction card ordering.
- **Styling**: the `/integrity` pages now use the app's global **Heebo** font (was Segoe UI);
  dialogs already inherit the global Material styling.
- **Report-config editor** — two new optional `ReportConfig` fields (sensor/group reports
  only, not written on health reports; saved on create/update, restored on edit, reset with
  the form):
  - `showSignalTables` — toggle "טבלאות סטטיסטיקה והתראות", default **off**
    (edit-restore: `=== true`, so existing docs stay off);
  - `zeroGroupSeries` — toggle "קבוצות: כל הקווים מאפס", default **on**
    (edit-restore: `!== false`, so existing docs behave as on).
  The reports service can start reading both fields.
- **Form polish**: the edit form's option checkboxes (Include Raw Axes Data, the two new
  signal options, Enable Chart Sampling) converted to `mat-slide-toggle` — same pattern as
  the health report's Show Connectivity toggle. Sensor/site/section selection grids remain
  checkboxes (multi-select lists, not options).

### Production go-live + registry option (b) (2026-10-06)

- **LIVE**: https://new-scanin-ui.web.app — two production deploys:
  1. the preview bundle cloned to live (`/integrity` + confirm-point flow + report-config
     signal toggles; commits `982a696`…`2aaa5e5`);
  2. registry option (b) on top (commit `810bf48`).
  Functions can now switch the WhatsApp message links to `/integrity/<noticeId>`.
- **Registry option (b)** — status:
  - The sensor page + prism chart were **already registry-driven** by the parallel commits
    (`1149c38`, `611be8b`, `80bf2f4`, `f116a70`): `shared/axis-registry.ts` builds the chart
    tabs from the `axes` registry (Hebrew labels תזוזה X/Y/Z, `order`, `chart:false` drops
    TwoD, "alerting axis always gets a tab"), falls back to legacy `chart-axes` when `axes`
    is missing, and the prism **2D/X-Y-Z toggle is gone** (one-axis-at-a-time tabs).
  - `810bf48` extends the same preference to the remaining `getTypeAxes` consumers that were
    still on legacy `chart-axes`: `sensor-data.service.getTypeAxes` now returns
    `[{key, unit, label}]` from the registry (chart !== false, ordered), legacy fallback
    only when `axes` is missing; updated consumers: group bulk-settings dialog, group view,
    data-handling-tools.
  - Side effect: the **group view's prism "daily data" toggle** finds no daily* axes under
    the registry — it always shows the raw X/Y/Z axes now. Aligned with dropping the daily
    series; the toggle itself can be removed in a follow-up if desired.

### Group view on smooth + /integrity UX fixes (2026-10-06, commit `cba0d57`, LIVE)

**Group view (`pages/sensor-groups/sensor-group-view`) — last prism-daily reader removed;
prism-daily can be paused:**
- Main line per sensor = stored `smooth.<axis>` (legend chip above the chart:
  "ממוצע ‹w› שעות (ללא חריגים)", w from `smooth.w`, fallback 24/48 by type); raw samples are
  an optional faint **"גולמי"** toggle; a sensor with no smooth in range falls back to raw
  (adjusted) as its main line.
- Zeroed mode re-zeroes each series (smooth and raw) at its first point in the window.
- Suspect samples and `daily::` docs excluded everywhere; axes labels/units/order from the
  registry (`getTypeAxes`). Removed: the "Daily" toggle + `showDailyData` +
  `processPrismAxes` + all daily* reads/labels/axis mappings, and the cosmetic "Smooth"
  tension toggle (tension 0 always). **Baseline markers skipped** here — N sensors × events
  means clutter + N extra queries; can add later if wanted.

**/integrity fixes (from the real-WhatsApp-link review):**
1. **No more false "אין התראות פתוחות" on query errors** — list (both tabs) and detail show
   a red error banner + console log instead of the empty state. Root cause of the 33-open
   case: the `(status ==, orderBy lastSeenAt desc)` query needs the **(status ASC,
   lastSeenAt DESC) composite index** (being created on the functions/rules side). All other
   /integrity queries checked: per-doc gets (no index), chart query is a single-field time
   range (no composite needed).
2. **Context + navigation**: settings-style breadcrumbs — list "הגדרות › תקינות נתונים",
   detail "הגדרות › תקינות נתונים › ‹kind›"; browser titles set via the Title service;
   detail header gains a פתוחה/טופלה status badge; sensor and project names are links
   (/s/:id, /sites/:siteId).
3. **Back link lands on the notice**: "→ כל ההתראות" navigates with `?highlight=<id>` — the
   list opens the right tab, scrolls to the card and highlights it (fade animation).
4. **Counts** on both tabs (פתוחות N / טופלו N — both tabs stay live-subscribed) and on
   every kind filter chip.
