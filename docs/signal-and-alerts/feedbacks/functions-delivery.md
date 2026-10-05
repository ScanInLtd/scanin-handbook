# Feedback: `scanin-svc-firebase-functions` — WhatsApp delivery reliability + inactive-sensor alerts (evening review 2026-10-05)

**Date:** 2026-10-05
**Repo:** [scanin-svc-firebase-functions](https://github.com/ScanInLtd/scanin-svc-firebase-functions)
**Status:** implemented & committed (**`91e1bdf`**), emulator burst test **8/8** + inactive check + Phase 4 regression green, leftover notice resolved. **NOT deployed — pending approval** (deploy needs the new alerts index first, see §4).

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

## 5. Open questions

1. `multiSensorAlerts` direct sends (§1) — migrate to the same outbox pattern, or leave (cooldown-throttled)?
2. Worst-case delivery latency is now up to ~1 min (scheduler tick). Acceptable, or add an onCreate nudge that triggers a drain immediately (lease makes it safe)?
3. Digest greeting: digests drop the personal "שלום ‹שם›" greeting (one message may span recipients' alerts only per phone, so a greeting is possible — kept impersonal for brevity). Fine?
