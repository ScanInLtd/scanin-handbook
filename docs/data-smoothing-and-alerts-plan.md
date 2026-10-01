# Data Smoothing & Alerting Overhaul — System-Wide Plan

_Status: PROPOSAL — July 2026_
_Authors: Hillel + Cascade (assessment session)_

---

## 1. Problem Statement

Raw sensor samples are jumpy. This causes two system-wide failures:

1. **Alert fatigue ("wolf-wolf")** — single noisy samples cross thresholds, fire alerts,
   settle back, and repeat. Users stop trusting alerts.
2. **Ugly charts & reports** — raw series in the web app and PDF reports look noisy and
   unprofessional, undermining the perceived value of the whole system.

A dominant, identified source of the fluctuation is the **24-hour temperature cycle**
(diurnal thermal expansion/contraction of structures and mounting hardware). On top of
that there are random spikes (measurement glitches, comms artifacts).

This plan defines a single, consistent smoothing strategy that alerts, UI charts, and
reports all share — while keeping raw data untouched as the source of truth.

> **Scope note:** This is a *pre-Postgres* patch. The system will eventually be
> refactored off Firestore; everything here is derived/recomputable data that maps
> cleanly onto SQL window functions later. Nothing blocks the refactor.

---

## 2. Current State (July 2026)

| Component | Repo | Behavior today |
|---|---|---|
| Ingestion | `scanin-svc-mqtt-bridge` | MQTT → `work-sensors/{id}/data-log` doc per sample |
| Threshold alerts | `scanin-svc-firebase-functions` (`checkThresholds`) | Fires on **every single-sample** status transition (ok→warn→alarm), 24h throttle per axis/level |
| EMA (existing) | same trigger | Optional per-sensor (`options.movingAverage.enabled`): incremental EMA → `ema` field on sensor doc + `ema-log` subcollection. `recalcEma` callable backfills. **Barely used.** |
| Multi-sensor alerts | `alerts/multiSensorAlerts.ts` | Group rules (all/majority/any) evaluated on alert creation, based on `status.axes` |
| UI charts | `scanin-web-platform` | Fetches `data-log`; optional **client-side** 24h trimmed moving average (ad-hoc, browser-computed); overlays `ema-log` if EMA enabled |
| Prism daily | `scanin-worker-prism-daily` | Midnight batch: daily averages → `daily::` docs (`source: derived:daily`, skipped by threshold checks) |
| Reports | `scanin-svc-reports` | Fetches raw `data-log`, renders PDF charts |

**Key structural problem:** there are already *three* different "smoothed" definitions
(client MA, server EMA, prism daily) and none of them drives alerting. Alerts run on the
noisiest signal in the system.

---

## 3. Design Decision: 24h Trimmed SMA

### Why SMA (not EMA)?

A simple moving average whose **window equals the period of a periodic disturbance
cancels it exactly** — including all harmonics (12h, 8h, 6h…). Since diurnal temperature
curves are asymmetric (fast heating, slow cooling), harmonics carry significant energy;
a 24h SMA nulls all of them. An EMA has no spectral nulls — it merely attenuates, leaving
a residual diurnal wobble plus phase lag.

Considered and rejected:

- **EMA / spike-rejected EMA** — cheapest (O(1) state, already built), but cannot cancel
  the 24h cycle. Was the preferred option when Firestore cost was a constraint; Didi has
  confirmed cost is currently acceptable, so correctness wins.
- **Half-period pairing** `(x(t) + x(t−12h))/2` — nulls the 24h fundamental with 2 points,
  but passes even harmonics (the 12h component) unattenuated and provides zero noise/spike
  suppression.

### Why trimmed?

Dropping the top/bottom N% of the window (default **10%**) before averaging *removes*
spikes entirely instead of diluting them. This matches the client-side MA behavior users
already know from the UI.

### The lag trade-off (must be communicated!)

A 24h SMA has an effective lag of ~12 hours. A genuine rapid structural movement appears
in the smoothed series at half strength only after ~12h. **This is why the two-tier alert
design below is mandatory, not optional.**

---

## 4. Target Architecture

### 4.1 Two-tier alerting

```
                        ┌────────────────────────────────────────┐
   new data-log doc ───►│ checkThresholds (existing trigger)     │
                        │                                        │
                        │  TIER 1 — RAW / CATASTROPHIC           │
                        │  raw adjusted value vs WIDENED         │
                        │  thresholds → immediate alert          │
                        │  (realtime safety net, no smoothing)   │
                        │                                        │
                        │  TIER 2 — SMOOTHED / TREND             │
                        │  24h trimmed SMA vs CURRENT (tight)    │
                        │  thresholds + N-sample persistence     │
                        │  → drives status.axes + trend alerts   │
                        └────────────────────────────────────────┘
```

- **Tier 1 (raw):** current threshold values get **multiplied/widened** (per-sensor
  config, e.g., ×2–×3 or explicitly set). A raw breach means "something is really wrong
  right now" → immediate alert, bypasses smoothing lag.
- **Tier 2 (smoothed):** the existing tight thresholds are evaluated against the smoothed
  value. Additionally require **persistence**: N consecutive smoothed samples beyond the
  threshold (default N=3) before the transition counts. Kills residual flapping.
- **`status.axes` (sensor color in UI, multi-sensor rules input) is driven by Tier 2**,
  with Tier 1 breaches able to force `alarm` immediately.
- **Multi-sensor rules** stay as-is — they automatically benefit since `status.axes`
  stops flapping.
- **Excluded sensor types:** `vibration-din` (has its own DIN 4150-3 event logic),
  `vibration_vf`. Prism daily docs (`source: derived:daily`) remain skipped.

### 4.2 Data model changes (Firestore)

| Item | Location | Content | Why |
|---|---|---|---|
| Rolling buffer | `work-sensors/{id}/state/rolling-buffer` (**sidecar doc**, NOT the sensor doc) | Last 24h of `{time, axes…}` samples (~144 entries @ 10-min cadence) | Window for SMA. Sidecar keeps the heavily-fetched sensor doc lean — clients always download whole docs. |
| Smoothed series | `work-sensors/{id}/sma-log` subcollection | One doc per sample: `{time, <axis>: smoothedValue…}` | Chart/report history. Mirrors existing `ema-log` shape so UI overlay code is reusable. |
| Latest smoothed | `sma` map on sensor doc | `{<axis>: value, updatedAt}` | Cheap access for dashboards/status logic (a few numbers only). |
| Persistence counters | `alert_state.axes.<axis>.breach_count` | int | N-consecutive-samples logic. |
| Tier-1 thresholds | `thresholds.axes.<axis>.catastrophic` (or `rawMultiplier` on sensor) | widened gaps | Raw safety-net levels. |
| Config | `options.smoothing` on sensor doc | `{enabled, windowHours: 24, trimPercent: 10, persistenceSamples: 3}` | Per-sensor opt-in and tuning. |

Cost per sample when enabled: **+1 read** (buffer doc) and **+2 writes** (buffer update,
sma-log doc) on top of today. Approved.

### 4.3 What happens to the EMA mechanism?

Keep it dormant (it's opt-in and unused). Do **not** build on it. If the SMA rollout
succeeds, deprecate `ema-log`/`recalcEma` in a later cleanup. Reuse its UI overlay
pattern for `sma-log`.

---

## 5. System-Wide Touchpoints

### 5.1 `scanin-svc-firebase-functions` (core — most work)

1. Extend `checkThresholds`:
   - Read/update rolling-buffer sidecar doc.
   - Compute 24h trimmed SMA per configured axis.
   - Tier-1 evaluation (raw vs widened), Tier-2 evaluation (SMA vs tight + persistence).
   - Write `sma-log` doc + `sma` field, batched with existing status/alert writes.
2. New callable `recalcSma` (modeled on `recalcEma`): rebuild buffer + `sma-log` from
   `data-log` history for a sensor/date-range. Needed for onboarding and corrections
   (e.g., after data adjustments by `scanin-worker-firestore-adjustments`).
3. Keep alert doc schema unchanged, add `tier: "raw" | "trend"` field so
   `handleAlerts` messaging can phrase them differently (🚨 vs 📈).

### 5.2 `scanin-web-platform` (UI)

1. **Default chart view = server smoothed series** (`sma-log`), raw as toggle
   (reuse/adapt existing `ema-log` overlay path in `sensor-chart-main` /
   `default-chart`).
2. **Demote/remove the client-side ad-hoc MA** — two different "smoothed" definitions on
   one screen will generate "why did I get an alert when the chart looks fine?" tickets.
   One truth: the server series.
3. Sensor settings UI: expose `options.smoothing` (enable, trim %, persistence) and the
   Tier-1 widened thresholds.
4. Threshold lines on the chart: show tight thresholds against the smoothed series;
   optionally show catastrophic lines when raw view is toggled.

### 5.3 `scanin-svc-reports`

- Report charts read `sma-log` when smoothing is enabled for a sensor (fallback:
  `data-log`). PDF trend line = UI trend line = alert input. One definition everywhere.

### 5.4 Untouched

- `scanin-svc-mqtt-bridge` — ingestion unchanged; `data-log` remains raw source of truth.
- `scanin-worker-prism-daily` — daily series continues as-is (it serves a different,
  longer-horizon purpose). Revisit overlap later.
- Multi-sensor alerts — unchanged code, better input.

---

## 6. Rollout Plan

### Phase 0 — Measure & pilot selection (≈1 day)
- Pull `system-metrics/alerts/daily` for the last 1–2 months; rank sensors by alert count.
- Pick 2–3 worst "wolf-wolf" sensors as pilots.
- Offline sanity check: export pilot `data-log` history, simulate 24h trimmed SMA +
  persistence in a script, count how many past alerts would have survived. Present
  before/after chart to Didi. **Gate: Didi approves the visual result.**

### Phase 1 — Backend (functions repo)
- Implement §5.1. Feature-flagged per sensor via `options.smoothing.enabled`.
- Enable on pilot sensors only. Run `recalcSma` to backfill ~90 days.
- Observe 1–2 weeks: alert volume, GCP logs, Firestore usage delta.

### Phase 2 — UI
- `sma-log` as default chart series, raw toggle, settings UI.
- Enable smoothing for all relevant sensor types site by site.
- Raise Tier-1 raw thresholds at the same time as each site is switched (otherwise
  double alerts during transition).

### Phase 3 — Reports
- Switch report generation to smoothed series for smoothing-enabled sensors.

### Phase 4 — Cleanup
- Remove client-side ad-hoc MA (or hide behind a debug flag).
- Deprecate EMA path if unused.
- Document final behavior in this handbook; update alert-message templates.

---

## 7. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| 12h smoothing lag hides a real event | Tier-1 raw catastrophic alerts; multi-sensor rules; comms/watchdog alerts unchanged |
| Sparse data (sensor sends rarely) makes 24h window degenerate | Require a minimum sample count in window (e.g., ≥6) else skip Tier-2 evaluation for that sample |
| Data adjustments/corrections invalidate buffer + sma-log | `recalcSma` callable; hook it into the adjustments worker flow |
| Buffer doc write contention (high-frequency sensors) | Buffer updated inside the same trigger, sequential per sensor; Firestore handles 1 write/sec/doc sustained — fine at 10-min cadence, review for vibration types (excluded anyway) |
| Transition period confusion (old tight raw alerts + new trend alerts) | Per-site cutover in Phase 2; alert messages labeled by tier |
| Firestore cost growth (`sma-log` doubles series storage) | Accepted by Didi; dies at the Postgres refactor anyway |

---

## 8. Open Questions

1. Exact widening rule for Tier-1 thresholds — global multiplier (×2? ×3?) or per-sensor
   manual values? (Recommend: multiplier default, manual override.)
2. Should prism sensors use this too, or is `prism-daily` + ATS runs already their
   smoothing story? (ATS measurements are batched runs, not continuous — likely exclude.)
3. Persistence N and trim % defaults — start with N=3, trim=10%, tune on pilots.
4. Should Tier-2 "settled" (recovery) notifications be sent? Today improvements are
   logged but not alerted.

---

## 9. Postgres Refactor Mapping (future)

| Firestore construct | SQL equivalent |
|---|---|
| `data-log` | raw samples table (hypertable) |
| rolling buffer sidecar | not needed — window query |
| `sma-log` | continuous aggregate / materialized view: `AVG(...) OVER (24h window)` with percentile trim |
| persistence counters | `COUNT(*) FILTER` over last N rows |
| Tier-1/Tier-2 | same rules, evaluated in one alerting worker |

The smoothing *policy* (window, trim, persistence, two tiers) survives the migration
verbatim; only the plumbing changes.
