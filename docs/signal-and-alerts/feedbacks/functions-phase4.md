# Feedback: `scanin-svc-firebase-functions` — Phase 4 two-tier alerts + full-history backfill (FN-4.1, 4.2, 4.5, 4.6 + FN-2.3 completion)

**Date:** 2026-10-05
**Repo:** [scanin-svc-firebase-functions](https://github.com/ScanInLtd/scanin-svc-firebase-functions)
**Status:** Phase 4 implemented & committed (**`dc272be`**), emulator **18/18** green, pilot backtest **−96%**. **NOT deployed — pending approval.** Full-history backfill: dry-run complete, hold-list produced (§1), **apply running** on the approved scope (will be updated here when done).

---

## 1. Full-history backfill (approved scope: smooth / eval / evaluator-suspect fields)

### Dry-run (`--days=all`, minus the 4 office test rigs)

268 sensors, **1,909,874 docs read, 1,695,529 would change** — in **6.2 min** at concurrency 3 (REST transport; the earlier gRPC instability is gone once the million-doc rigs are excluded). Totals: withSmooth 1,570,330 (86.7% of processed), **would-be suspects 122,759**, suspectsCleared 146, missMinN 79,946, missCoverage 37,886. Est. cost: $1.15 reads + $3.05 writes.

Per type: OPKON-100 97.8% · OPKON-60 97.3% · battery 90.9% · crack 92.7% · cracktemp 96.4% · loadcell 96.3% · **prism 58.8%** · tilt 83.2% (full-history coverage is lower than the 90d numbers because old eras are dirtier — exactly the suspect clusters below).

### HOLD list (> 5% would-be suspects) — sent for review, NOT backfilled

**52 sensors carry 121,558 of the 122,759 suspects (99%).** As predicted: long "stuck eras" from historical re-zeros the migration never captured as baseline events. Dominated by JTCS prisms (H0/H2/H3/NEVIM61 families, 33–98% suspect share), the צייטלין tilts (נטייה 1/2/3/5/6 at 66–85%), office cracktemps, `Ci5mmC7CTZ9TU0AFKRwG` "8" (16,504/29,122 = 57%), and `sen-OPKON_100_Potentiometer-CRAK-WISKY-11` (11,360/34,872 = 33%). Full list with ratios: run
`python3 -c` over `scripts/.recompute-checkpoint-fh2.jsonl` (per-sensor stats now live in the checkpoint lines) — or see the session log; the exact IDs were handed over in the reply.

### Apply (216 sensors = 268 − 4 rigs − 52 held)

Running at the time of writing (`--run=fh2-apply`, checkpointed, resumable); ~1.7M reads / ~1.5M writes expected. **Result to be appended here.**

---

## 2. Phase 4 — what changed (commit `dc272be`)

| File | Content |
|---|---|
| `src/tiers.ts` (new) | Pure `evaluateV2Axis`. **Tier 2 'confirmed'**: smooth vs warn/alarm; escalate only ≥ 3h AND ≥ 2 evaluations beyond the level (`candidate {level, since, count}` persisted in alert_state); de-escalate stepwise only below **80% of the gap**; one alert per escalation; no reminders / 24h re-alerts. **Tier 1 'instant'**: `|raw adjusted − ref| > instant.gap` (default **2 × alarm gap**; if the default ≥ suspect.jump → tier **off** for that axis); confirmed by the next sample (`instantPending`); one alert per episode (`instantEpisode`, ends below half the gap); forces status `alarm` until Tier 2 takes over. |
| `src/checkThresholds.ts` | Reads `projects/{site}.alerting` inside the transaction. **v2 sites**: raw Phase-0 rule skipped; status.axes + `eval` (now authoritative) + alert docs driven by the tiers. **v1 sites**: UNCHANGED behavior + faithful `[v2-shadow] sensor axis status [ALERT tier level]` log — v2 state (candidate/pending/episode) is persisted for ALL sites so the shadow has real continuity. Tier alert docs carry `tier, smoothValue, baseline (initial-value), persistedHours, confirmations, sampleTime` + Hebrew summaries per FN-4.5 with chart link `{APP_URL}/s/<sensorId>`: ⚡ "‹sensor› ‹axis› קפץ ‹Δ› תוך ‹h› שעות (מ-‹ref› ל-‹value›), אושר ע״י 2 קריאות", 📈 "הממוצע (‹w› שעות) של ‹sensor› ‹axis› מעל סף ‹level› כבר ‹h› שעות (כעת ‹smooth›)". |
| `src/alerts/multiSensorAlerts.ts` | **FN-4.6**: optional `rule.tier` condition — rule reacts only to alerts of that tier; rules without it match all. |
| `src/shared-status-types/shared-types.ts` | `AxisAlertState` + `candidate` / `instantPending` / `instantEpisode`; `MeasurementAlert` + the tier fields. |
| `src/setBaseline.ts` (fix B1) | Auto-initial computes medians for **threshold axes only** (a loadcell's raw counts no longer gets an initial); empty 24h-after window → falls back to the 24h **before** `time`; `initialSource` documents which window was used. |
| `src/processDataRequest.ts` (fix B2) | CSV/XLSX exports drop the `smooth` / `eval` map columns (exported empty); `suspect` kept. |
| `src/integrity/notifyDataIntegrity.ts` (new, fix B3) | WhatsApp sender on `data-integrity` **creation only** (count bumps are updates → no re-send). Config `system-config/data-integrity {enabled, whatsappGroup, minSeverity}`; missing/`enabled!==true` → no sends (**disabled by default**); sets `notifiedAt`; reuses `alerts/whatsappService.ts`; failures never propagate. |
| `scripts/recompute-smoothing.js` | `--exclude=<ids>`; checkpoint lines now carry per-sensor stats (powers the hold-list). |
| `scripts/test-phase4-emulator.js` (new) | 18-check acceptance suite. |
| `scripts/backtest-v2-zeitlin.js` (new) | Read-only v1-vs-v2 replay over stored smooth/raw. |

**Instant-off axes in prod** (default 2×alarm ≥ suspect.jump): applies to axes where `2 × alarm.gap ≥ suspect.jump` — with current defaults this is mostly **tilt axes with alarm ≥ 0.5°** (default suspect.jump 1°) and **crack x with alarm ≥ 2.5mm** (jump 5mm). These are logged per evaluation (`instant-off` suffix in the shadow line); exact list queryable from the shadow logs after a day of running.

## 3. Emulator results — 18/18 ✅

| Scenario | Result |
|---|---|
| Oscillating raw noise around warn (v2) | **0 alerts**, status stays ok (raw crossed warn repeatedly — v1 would have alerted) |
| Stable step above warn (v2) | exactly **1 `confirmed`** alert, persistedHours ≥ 3, confirmations ≥ 2, status → warn, Hebrew 📈 summary + `/s/` link |
| Single raw spike (v2) | **no alert** (pending cleared by the next normal sample) |
| 2-sample jump (v2) | exactly **1 `instant`** alert (⚡ summary, "אושר ע״י 2 קריאות"), status forced **alarm**; a 3rd jumping sample → still 1 alert (episode) |
| v1 site | Phase 0 raw alert fired immediately, **no tier field**, status warn — unchanged |
| De-escalation hysteresis | held warn while smooth ∈ [0.4, 0.5) (gap 0.5), dropped to ok only below 0.4; no alerts on the way down |
| Instant-off rule (pure) | default gap ≥ suspect.jump → `instantDisabled`, no pending/alert |

Shadow log sample (from the v1-site scenario): `[v2-shadow] p4-v1sensor x status=ok`

## 4. Backtest — צייטלין 12, last 60 days (stored smooth + raw, read-only)

| Sensor | samples | v1 alerts | v2 alerts |
|---|---|---|---|
| נטייה 7 | 1,284 | 74 | **2** (confirmed) |
| נטייה 6 | 1,317 | 78 | **2** (confirmed) |
| נטייה 4 | 1,373 | 39 | **1** (confirmed) |
| סדק 1 שירותים | 712 | 19 | **1** (instant) |
| נטייה 5 | 1,314 | 8 | 3 (confirmed) |
| נטייה 1 / נטייה 3 | 1,481 / 1,583 | 5 / 2 | 0 / 0 |
| others (5 sensors) | — | 0 | 0 |
| **TOTAL** | — | **225** | **9** (8 confirmed + 1 instant) — **−96%** |

Beats the plan's −70% acceptance bar and the −80% backtest projection.

## 5. Deploy plan (pending approval) & rollback

1. `firebase deploy --only functions:checkThresholds,functions:setBaseline,functions:recomputeSmoothing,functions:notifyDataIntegrity` (processDataRequest ships with whichever function exports it — included in the same deploy if separate). No index/rules changes.
2. Watch `[v2-shadow]` logs for a few hours fleet-wide (v1 everywhere initially).
3. Hillel sets `projects/oBcqejjRiLRIFhG2UzPI.alerting = 'v2'` (צייטלין 12 only).
4. `notifyDataIntegrity` stays dormant until `system-config/data-integrity.enabled = true` (Hillel).

**Rollback:** redeploy `8d3cc99` — v2 never drives anything without the flag anyway, so clearing the project flag is the instant kill-switch; shadow state fields in alert_state are inert.

## 6. Open questions

1. **Hold-list review (52 sensors):** these need baseline-events for their historical re-zeros before their history can be filled (or a decision to leave their history un-smoothed). Process with Nathan per family (JTCS prisms → ATS repair; צייטלין tilts → likely recorded re-zeros)?
2. `baseline` field on tier alerts = the axis' current initial-value (chose this over ref; ref is carried separately on instant alerts) — confirm.
3. The backtest's 9 v2 alerts: want the per-alert details (times/values) to sanity-check against the charts before flipping the flag?
4. Tier 2 candidate resets when the level changes (warn-candidate → alarm readings restart the clock at alarm) — per the contract's single-candidate shape; acceptable?
