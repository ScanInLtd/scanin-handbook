# Feedback: `scanin-svc-firebase-functions` — WhatsApp delivery reliability + inactive-sensor alerts (evening review 2026-10-05)

**Date:** 2026-10-05
**Repo:** [scanin-svc-firebase-functions](https://github.com/ScanInLtd/scanin-svc-firebase-functions)
**Status:** ✅ approved + two additions (§6), committed **`91e1bdf`** + **`a3a0e34`**, index `alerts(whatsappPending, time)` READY, **deployed 2026-10-05 21:07 UTC** (handleAlerts, notifyDataIntegrity, checkThresholds, sendWhatsappAlerts·new, evaluateMultiSensorRules, cleanUnconfirmedSensors). Emulator: burst **8/8**, additions **10/10**, regressions green. Bridge `4450a5b` can deploy (item 3 is live).

---

## 1. WhatsApp delivery — the alert doc is the outbox, one serial sender

**Problem:** 2026-10-05, ~50-alert burst → one `handleAlerts` invocation per alert, parallel sends, WaSender Account Protection ("1 message every 5 seconds") 429'd most sends past the 2 per-invocation retries — **messages were silently lost**. In-process throttling can't coordinate across invocations.

**Design (final, as specified — no new collection):**

| Piece | Implementation |
|---|---|
| Writers | `handleAlerts` keeps its recipient logic (subscriptions, mute, 24h notif skip) and **email stays direct**; for WhatsApp it only writes onto the alert doc: `whatsapp: {pending: [{to, firstName, attempts}], sent: [], failed: []}` + `whatsappPending: true` (+ `sensorName`/`sensorType` so the sender can rebuild messages from the doc alone). `notifyDataIntegrity` uses the same pattern on its own notice docs (`whatsapp` + `whatsappPending`; the sender sets `notifiedAt`) — still disabled by default. |
| Sender | `sendWhatsappAlerts` (new, `src/alerts/whatsappSender.ts`): **scheduled every minute**, Firestore lease (`system-config/whatsapp-sender.leaseUntil`) guarantees one running instance; exits instantly when idle. Queries `alerts where whatsappPending == true` (orderBy time — new composite index), groups by phone and sends **serially**. |
| Digest | 1 alert → the regular per-alert message (as today, incl. the greeting); 2+ alerts to the same phone → one digest: `"‹n› התראות חדשות ב‹site›:"` + one line per alert (severity emoji, sensor, axis label, value+unit, chart link). |
| Pacing (ported from commodex `wasender.ts`, read-only reference) | ≥ 5.5s between sends (`WASENDER_MIN_INTERVAL_MS`); on 429 wait `retry_after` (body) or `X-RateLimit-Reset` (header) + 0.5s (capped 120s) and retry, up to 3 attempts per message. |
| Failure handling | A phone that still fails after 3 **sender passes** → `whatsapp.failed: [{to, at, error}]` + an **error log with the alert ids** — never silently dropped. Partial failures leave the other recipients' entries intact; `whatsappPending` clears only when the pending list is empty. `system-metrics/alerts/daily` counters moved to the sender (counted on actual delivery). |
| Not changed | `multiSensorAlerts` (rare, rule-cooldown-throttled) still sends directly through the old path — flagging it; trivial to migrate later if wanted. |

**Emulator acceptance (8/8):** 50 alerts created in ~10s for a project with 2 WhatsApp subscribers, against a **fake WaSender that 429s every other request** (faster than 1/5s): all 50 alerts queued by `handleAlerts`; one sender pass delivered **exactly 2 digest messages** ("50 התראות חדשות בWA בדיקות:" + 50 lines with chart links); **every alert's `whatsapp.sent` filled for both recipients, zero failed, zero left pending**; the 429 path exercised on every message.

## 2. Inactive sensors never alert

32 of the 50 burst alerts came from **inactive auto-created ATS sensors** draining backlogs. Now, for `active === false` sensors, `checkThresholds` skips: v1 raw-rule evaluation, suspect QC, the v2 tiers, DIN evaluation and late-data notices — each with a `SKIP-INACTIVE` log. **Smoothing and the stateless `eval` shadow verdict are still written** (chart/report continuity). Status never moves, alerts never created. Emulator check: inactive sensor with 8 crossing samples → 0 alerts, status ok, `smooth` + `eval` present on the samples.

## 3. Leftover notice resolved ✔

`data-integrity/7Nin7xfIAzav643CeTNc` (late-data for `lpKZ0eGsgnLC0d6j3oVB__rename-test-20261005`, "174 days behind" — the UI rename-test doc, already deleted) → `status: resolved, resolution: released`, done 2026-10-05.

## 4. Deploy plan (pending approval) & rollback

1. **Index first** (additive, gcloud): `alerts (whatsappPending ASC, time ASC)` — the sender's query fails without it. Recorded in `firestore.indexes.json`.
2. `firebase deploy --only functions:handleAlerts,functions:notifyDataIntegrity,functions:checkThresholds,functions:sendWhatsappAlerts` (sendWhatsappAlerts is a new v2 scheduled function).
3. Watch the first real burst: `whatsapp-sender:` logs (digests, 429 waits), `whatsapp.failed` must stay empty, `SKIP-INACTIVE` counts.
4. **Rollback:** redeploy `514ee06` — handleAlerts goes back to direct sends; any alerts stuck with `whatsappPending: true` keep their pending lists (re-queriable); delete the `sendWhatsappAlerts` function.

## 5. Open questions (answered — review 2026-10-05 evening)

1. `multiSensorAlerts` → outbox: **done this round** (§6.3). ✔
2. ~1 min latency: fine, no nudge. ✔
3. Impersonal digest: fine. ✔

---

## 6. Review additions (`a3a0e34`, deployed 2026-10-05 21:07 UTC)

### 6.1 `confirmed === false` → no threshold alerts (SKIP-UNCONFIRMED)

Auto-created ATS points now get registry thresholds from the bridge (`4450a5b`) and stay `confirmed: false` while being set up. Same scope as SKIP-INACTIVE: v1/v2 evaluation, suspect QC, DIN and late-data notices skipped; **smoothing + stateless `eval` kept**. Strictly `=== false` — a missing field is a normal sensor. Emulator: 8 crossing samples on an unconfirmed sensor → 0 alerts, smooth+eval written, status untouched.

### 6.2 `cleanUnconfirmedSensors` — clean deletes, day-5 warning

- 7-day grace kept (intended: Nathan confirms new points same-day).
- **`db.recursiveDelete(sensorRef)`** — doc + data-log + baseline-events + any subcollection (plain doc deletes used to orphan subcollections, e.g. `a079e4qX09IrQcHB5QK2`: no doc, 44 data-log docs).
- **`ats-device-map` entries whose `sensorId` points at the sensor are deleted FIRST** — the bridge never writes into a deleted sensor; if the point keeps sending, the bridge auto-creates it again (unconfirmed → silent).
- **Day-5 notice** per sensor: `unconfirmed-sensor` (warning), "‹name› ממתין לאישור, יימחק ב-‹date›"; resolved when confirmed (`auto`) or deleted (`released`). New `IntegrityKind` added.
- The cleanup report email now lists deletions + map-entry count.
- Existing orphan data-logs untouched (separate decision, as instructed).

### 6.3 `multiSensorAlerts` → outbox

Recipient collection unchanged; the **rule doc** carries `whatsapp {pending, text, sent, failed}` + `whatsappPending`. The sender's notice-like drain was generalized (one prebuilt text, N recipients) and covers `data-integrity` + `multi-sensor-rules`.

### 6.4 Verification & deploy

- Emulator additions suite **10/10** (unconfirmed skip; rule-doc drain; cleanup: day-8 recursive delete incl. subcollection + map entry, day-6 kept with day-5 notice, confirmed sensor's notice resolved) + WhatsApp burst suite re-run **8/8**.
- Index `alerts (whatsappPending ASC, time ASC)` created additively, **READY** before deploy.
- **Deployed 21:07 UTC, 0 errors.** `sendWhatsappAlerts` created; first scheduler ticks clean.
- **Rollback:** redeploy `514ee06` + delete `sendWhatsappAlerts`.
