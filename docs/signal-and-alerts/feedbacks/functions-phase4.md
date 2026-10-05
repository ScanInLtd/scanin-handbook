# Feedback: `scanin-svc-firebase-functions` — Phase 4 two-tier alerts + full-history backfill (FN-4.1, 4.2, 4.5, 4.6 + FN-2.3 completion)

**Date:** 2026-10-05
**Repo:** [scanin-svc-firebase-functions](https://github.com/ScanInLtd/scanin-svc-firebase-functions)
**Status:** ✅ approved with the cumulative-clocks fix (§7), committed **`dc272be`** + **`7e4f6e1`**, **deployed 2026-10-05 06:26 UTC** (checkThresholds, setBaseline, recomputeSmoothing, notifyDataIntegrity, evaluateMultiSensorRules), emulator **22/22**, pilot backtest **−96%**. Full-history backfill **APPLIED** on the approved scope (§1); hold list → [`hold-list-2026-10-05.md`](../hold-list-2026-10-05.md). Pending: 6h `[v2-shadow]` fleet summary (§8), then Hillel flips צייטלין 12 to v2.

---

## 1. Full-history backfill (approved scope: smooth / eval / evaluator-suspect fields)

### Dry-run (`--days=all`, minus the 4 office test rigs)

268 sensors, **1,909,874 docs read, 1,695,529 would change** — in **6.2 min** at concurrency 3 (REST transport; the earlier gRPC instability is gone once the million-doc rigs are excluded). Totals: withSmooth 1,570,330 (86.7% of processed), **would-be suspects 122,759**, suspectsCleared 146, missMinN 79,946, missCoverage 37,886. Est. cost: $1.15 reads + $3.05 writes.

Per type: OPKON-100 97.8% · OPKON-60 97.3% · battery 90.9% · crack 92.7% · cracktemp 96.4% · loadcell 96.3% · **prism 58.8%** · tilt 83.2% (full-history coverage is lower than the 90d numbers because old eras are dirtier — exactly the suspect clusters below).

### HOLD list (> 5% would-be suspects) — sent for review, NOT backfilled

**52 sensors carry 121,558 of the 122,759 suspects (99%).** As predicted: long "stuck eras" from historical re-zeros the migration never captured as baseline events. Dominated by JTCS prisms (H0/H2/H3/NEVIM61 families, 33–98% suspect share), the צייטלין tilts (נטייה 1/2/3/5/6 at 66–85%), office cracktemps, `Ci5mmC7CTZ9TU0AFKRwG` "8" (16,504/29,122 = 57%), and `sen-OPKON_100_Potentiometer-CRAK-WISKY-11` (11,360/34,872 = 33%). Full list with ratios: run
`python3 -c` over `scripts/.recompute-checkpoint-fh2.jsonl` (per-sensor stats now live in the checkpoint lines) — or see the session log; the exact IDs were handed over in the reply.

### Apply (216 sensors = 268 − 4 rigs − 52 held) — ✅ DONE

**216/216 sensors, 1,640,184 docs read, 1,476,815 written, 34.7 min, 0 failures** (REST transport + retries held). Suspects flagged on the applied set: only **1,201** (the hold list carried 99% of them). Full-history smooth coverage on the applied set: crack 95.0% · cracktemp 98.4% · OPKON ~97% · battery 90.9% · **prism 90.3%** · tilt 89.3% (the "clean" fleet looks much better than the raw full-history numbers — the dirt was concentrated in the held sensors). Cost ≈ $0.98 reads + $2.66 writes.

Hold list (52 sensors, id + name + project + suspect share): [`hold-list-2026-10-05.md`](../hold-list-2026-10-05.md). Their last 90 days ARE backfilled; full history stays un-smoothed until the re-zero baseline events are created (review with Nathan per family), then per-sensor: `node scripts/recompute-smoothing.js --sensor=<id> --days=all --apply`.

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

## 6. Open questions (answered — review 2026-10-05)

1. Hold-list review with Nathan per family later; history stays un-smoothed meanwhile. List → `hold-list-2026-10-05.md`. ✔
2. `baseline` = current initial-value: confirmed. ✔
3. Backtest alert details: added (§9). ✔
4. Candidate reset across levels: **fixed** — cumulative per-level clocks (§7). ✔

---

## 7. Review fix: cumulative per-level candidate clocks (`7e4f6e1`)

The single candidate reset whenever the level changed, so smooth hovering around the **alarm** gap (alternating warn/alarm readings) never accumulated 3h at either level — despite being beyond warn the whole time.

- `alert_state.axes.<axis>.candidate` → `{ warn: {since, count} | null, alarm: {since, count} | null }`. Beyond alarm bumps **both** clocks; beyond warn only bumps warn and clears alarm; below 80% of warn clears both; the 80%–100% warn band holds the clocks (hysteresis).
- Escalate to the **highest** level above the current status whose own clock has ≥ 3h AND ≥ 2 evaluations. Warn escalation keeps the alarm clock running; alarm escalation clears both.
- Legacy single-candidate shape read gracefully (`normalizeCandidates`).
- Emulator (suite now **22/22**): alternating 1.05/0.95 around alarm (warn 0.5 / alarm 1.0) for 4h → exactly **1 confirmed WARN**; continuous ≥ 3h beyond alarm afterwards → **1 ALARM**; legacy-shape carry-over escalates correctly.

---

## 8. Deploy report

- **Deployed 2026-10-05 06:26 UTC**, 0 errors: `checkThresholds` / `setBaseline` / `recomputeSmoothing` / `evaluateMultiSensorRules` updated, **`notifyDataIntegrity` created** (dormant — `system-config/data-integrity` doc absent; Hillel enables).
- `processDataRequest.ts` turned out to be **dead code** — its exports (`createSensorTasks` / `processSensorTask` / `aggregateResults`) are not in `index.ts` and no matching functions exist in prod. The export fix is committed but inert; worth a cleanup decision later.
- No project flag set — all sites on v1, shadow running fleet-wide.
- **Pending:** [ ] **~6h `[v2-shadow]` fleet summary** (due ~12:30 UTC): per project, v1 alerts fired vs v2 would-have-fired + the instant-off axes list. Will be appended here. Then Hillel sets `projects/oBcqejjRiLRIFhG2UzPI.alerting = 'v2'`.
- **Rollback:** clear the project flag (instant, per site); full rollback = redeploy `8d3cc99`.

---

## 9. Backtest alert details (צייטלין 12, 60d — for chart verification)

Totals: **v1 = 227 → v2 = 9** (8 confirmed + 1 instant), **−96%**.

| Sensor | Axis | Tier | Level | Sample time | smooth | raw adj | Extra |
|---|---|---|---|---|---|---|---|
| נטייה 7 (`2bFvKSdK5P34K6IoV7xS`) | y | confirmed | warn | 2026-08-06 11:00Z | 0.1239 | 0.1270 | 4.0h, 5 evals |
| נטייה 7 | y | confirmed | alarm | 2026-08-11 22:00Z | 0.1318 | 0.1300 | 3.0h, 4 evals |
| סדק 1 שירותים (`Y5Fmj6xhyJxESk2DOI7U`) | x | **instant** | alarm | 2026-10-05 02:46Z | −0.1588 | 2.4973 | jump 2.656 vs ref −0.159 |
| נטייה 5 (`cBYnPKmA2NUoU7KHpLCP`) | x | confirmed | alarm | 2026-08-17 01:00Z | 0.1079 | 0.1150 | 3.0h, 4 evals |
| נטייה 5 | y | confirmed | warn | 2026-08-17 01:00Z | 0.0195 | 0.0190 | 3.0h, 4 evals |
| נטייה 5 | y | confirmed | alarm | 2026-08-28 17:00Z | 0.0201 | 0.0200 | 3.0h, 4 evals |
| נטייה 6 (`iu1fbCeEi6sBW9UGdJTR`) | y | confirmed | warn | 2026-08-06 11:00Z | −0.0822 | −0.0300 | 4.0h, 4 evals |
| נטייה 6 | y | confirmed | alarm | 2026-08-20 03:00Z | −0.1007 | −0.1090 | 4.0h, 5 evals |
| נטייה 4 (`nG4q9Y0zYV6W2SgfWFB3`) | x | confirmed | alarm | 2026-08-17 01:00Z | 0.1456 | 0.1430 | 3.0h, 4 evals |

Chart links: `https://new-scanin-ui.web.app/s/<sensorId>`. Note the instant alert on סדק 1 is dated 2026-10-05 02:46 — a fresh real jump last night, worth a look regardless of the rollout. Re-runnable: `node scripts/backtest-v2-zeitlin.js --days=60 --details`. *(Superseded by §10 — the סדק 1 "instant" was alternating glitches; the fixed rule removes it.)*

---

## 10. Review #2 fixes (2026-10-05, commit `fff8937`, deployed 07:38 UTC)

### 10.1 BLOCKING fix — Tier 1 confirmation requires direction + level agreement

The backtest's instant on סדק 1 שירותים was alternating glitches (raw 8.80 → 9.81 → **6.21** → **11.48** → 8.79, stable ~8.8): the −2.6 and +2.7 glitches "confirmed" each other. New rule in `tiers.ts`: a pending jump is confirmed only if the next sample jumps in the **same direction** (sign of `adj − ref`) **and** sits at the **same level** (`|adj − pending| ≤ ½ × instant.gap`); otherwise the pending is dropped and the new sample becomes a fresh candidate.

- **Emulator** (suite now **26 checks, all green**): alternating +5/−5/+5 glitches → 0 instants (old rule alerted on the 2nd); same-direction but different level (5 → 9.5) → still 0; a real step held over two agreeing samples → exactly 1 instant.
- **Backtest re-run (60d):** **v1 = 228 → v2 = 8** (8 confirmed, **0 instant**) — still **−96%**; the 8 confirmed alerts are identical to §9's list (the false instant is gone, nothing else moved).

### 10.2 Alert-doc fixes (UI census)

- **siteName/sectionName:** alert docs carried "Unknown Site/Section" — `location` on sensors holds only ids. `resolveLocationNames` now resolves `projects/{site}.name` + `sections/{section}.name` at alert creation, cached per instance (1h TTL); applied to v1/v2 threshold alerts and the DIN path. **WhatsApp/email were never wrong** — `handleAlerts` already resolved names from Firestore at send time; only the stored docs had Unknowns.
- **sensorDocId + sampleTime on every alert:** threshold v1/v2 already carried both; **DIN alerts now carry `sampleTime`** too. `evaluateMultiSensorRules` writes no alert docs (WhatsApp only), so the guarantee covers all alert-doc writers.
- **Index `alerts (sensorDocId ASC, time DESC)`:** already exists in prod (READY) — recorded in the repo's `firestore.indexes.json`; nothing was created.

### 10.3 Deploy

`checkThresholds` redeployed **2026-10-05 07:38 UTC**, 0 errors (the only function whose bundle changed). The **6h `[v2-shadow]` summary clock restarts from this deploy — due ~13:40 UTC**; will be appended here (per project: v1 fired vs v2 would-fire + instant-off axes). v2 flag still not set — Hillel flips it after reviewing the re-run backtest above.

### 10.4 Heads-up acknowledged

`axes.md` (decisions A–C, X0–X7 rollout) read — no work done. Noted for the next round: X3 (registry loader in functions replacing `shouldEvaluateAxis` / suspect defaults / level-shift axes / message labels) touches exactly the files from this phase; the prism E/N unhide (X4) interacts with the v2 backtests per project.
