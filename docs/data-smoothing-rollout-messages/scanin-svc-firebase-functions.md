# Task Brief: `scanin-svc-firebase-functions` — Two-Tier Alerting + Server-Side 24h Trimmed SMA

_Full design & rationale: `scanin-handbook/docs/data-smoothing-and-alerts-plan.md` (read it first)._
_This repo is **Phase 1** — everything else depends on it._

## Why

Alerts currently fire on single raw samples. Raw data is jumpy (mostly 24h temperature
cycles + spikes), so users get flooded with false alerts ("wolf-wolf"). We're moving
alerting and status to a **server-computed smoothed series**, with widened raw thresholds
kept as a realtime safety net.

## What to build

### 1. Extend `checkThresholds` (src/checkThresholds.ts)

For sensors with `options.smoothing.enabled === true` (new config object, see below):

- **Rolling buffer**: read sidecar doc `work-sensors/{id}/state/rolling-buffer`
  (NOT the sensor doc — it's fetched everywhere and must stay lean). Append the new
  sample, evict entries older than `windowHours`. Write back.
- **Trimmed SMA**: per configured axis, sort window values, drop top & bottom
  `trimPercent`%, average the rest. Use *adjusted* values (raw − initial-value), same as
  current threshold logic.
- **Tier 2 (trend) evaluation**: compare SMA vs the existing tight `thresholds.axes`,
  BUT require `persistenceSamples` consecutive breaching samples before a status
  transition counts (track `breach_count` in `alert_state.axes.<axis>`).
  **Tier 2 drives `status.axes`** (UI colors + multi-sensor rules input).
- **Tier 1 (raw/catastrophic) evaluation**: compare the raw adjusted value vs **widened**
  thresholds (`thresholds.axes.<axis>.catastrophic` if set, else
  `gap × options.smoothing.rawMultiplier`, default ×2.5). Breach → immediate alert +
  force status to `alarm`. No persistence, no smoothing — this is the safety net for the
  ~12h SMA lag.
- **Outputs** (batched with the existing status/alert writes):
  - `sma-log` subcollection doc: `{ time, <axis>: smoothedValue, ... }` (mirror the
    existing `ema-log` shape so the UI overlay path is reusable).
  - `sma` map on the sensor doc: `{ <axis>: latestValue, updatedAt }`.
- **Guards**: skip Tier 2 if the window has fewer than `minWindowSamples` (default 6)
  samples. Keep existing skips: `source === 'derived:daily'`, `vibration-din`,
  `vibration_vf` — smoothing does NOT apply to them.

### 2. Sensor config schema

```jsonc
// work-sensors/{id}.options.smoothing
{
  "enabled": true,
  "windowHours": 24,        // window == diurnal period → cancels temperature cycle
  "trimPercent": 10,        // outlier trim per side
  "persistenceSamples": 3,  // consecutive breaches required for Tier-2 transition
  "rawMultiplier": 2.5      // Tier-1 widening when no explicit catastrophic gaps
}
```

### 3. New callable: `recalcSma`

Model on the existing `recalcEma` (src/recalcEma.ts): admin-only, takes
`{ sensorId, daysBack }`, deletes `sma-log` in range, replays `data-log` chronologically
maintaining the rolling window, rewrites `sma-log` + final `sma` + rebuilt
`rolling-buffer`. Needed for pilot onboarding and after data corrections by
`scanin-worker-firestore-adjustments`.

### 4. Alert doc: add `tier` field

Keep the alert schema otherwise unchanged; add `tier: "raw" | "trend"` so `handleAlerts`
can phrase messages differently (🚨 immediate vs 📈 trend). Update the WhatsApp/email
templates accordingly.

## Cost impact (approved by Didi)

+1 read (buffer doc) and +2 writes (buffer, sma-log) per sample, only for enabled sensors.

## Acceptance criteria

- [ ] Feature entirely opt-in per sensor; sensors without `options.smoothing` behave exactly as today.
- [ ] Pilot sensor enabled + `recalcSma` backfilled → `sma-log` series visibly flat vs raw, diurnal cycle gone.
- [ ] Simulated breach: Tier-2 alert only after N persistent smoothed breaches; Tier-1 alert immediately on raw catastrophic breach.
- [ ] `status.axes` no longer flaps on pilot sensors (compare `system-metrics/alerts/daily` before/after).
- [ ] DIN/vibration/daily-derived paths untouched (regression check).

## Out of scope here

UI changes (web-platform brief), report changes (reports brief), removing the EMA
mechanism (leave dormant for now).
