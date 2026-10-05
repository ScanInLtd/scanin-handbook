# Feedback: `scanin-svc-firebase-functions` — Phase 1 "Data correctness" + smoothing in shadow (FN-1.1 … FN-1.6, FN-2.1, FN-2.4)

**Date:** 2026-10-04
**Repo:** [scanin-svc-firebase-functions](https://github.com/ScanInLtd/scanin-svc-firebase-functions) (+ one rules edit in `scanin-web-platform`)
**Status:** ✅ reviewed & approved (with changes — see §9), committed **`26c99a5`**, **deployed to prod 2026-10-04 15:24 UTC** (indexes READY first), emulator acceptance **35/35 green**. Pending: migration `--apply` (Hillel), 1h log review (§10).

---

## 1. What changed

| File | Content |
|---|---|
| `src/integrity/integrityService.ts` (new) | **FN-1.5** `raiseIntegrity` (transaction: open doc by `dedupeKey` → `count++` / `lastSeenAt`, else create), `resolveIntegrity(dedupeKey, resolution, by)`, `resolveAllForSensor` (used by setBaseline), `integrityDedupeKey`. All swallow errors — a failed integrity write never fails sample evaluation. `raiseIntegrity` returns `{created}` so callers can gate follow-up writes. |
| `src/smoothing.ts` (new) | Pure maths, no I/O: `median` / `mad` / `trimmedMean`, `computeSmooth` (3×MAD rejection → 20% trimmed mean; min n = max(3, ¼ × expected/day); expected/day = 24h ÷ median **positive** spacing — zero gaps from devices writing each axis as a separate doc are ignored), `filterWindow` (drops suspect / isReplay / `source: replay｜derived:daily` / `daily::*` / pre-baseline samples; counts excluded replay docs), `getSuspectLimits` (explicit config wins, else per-type default). |
| `src/checkThresholds.ts` | **FN-1.1 + FN-2.1**, all inside the existing Phase 0 transaction (reads before writes): sensor doc → latest baseline event (`time ≤ sample.time`) → 24h window, via `tx.get`. **Suspect check** per axis vs the persisted `ref`; any violation → whole sample flagged (`suspect`, `suspect_reason`, `suspect_axis`, `eval.<axis>='suspect'` in one update), threshold eval + smoothing skipped, `suspectSince` set, post-commit `raiseIntegrity` (critical). Clean samples: Phase 0 raw rule **unchanged** (alerts), then `smooth` + shadow `eval` written back to the sample doc in **one** `tx.update`. `ref = smooth[axis]` only from non-suspect samples that got a smooth value; persisted, never expires; first evaluation seeds it from its own window (history already in data-log). First good sample clears `suspectSince` → post-commit auto-resolve of both jump/range notices. **FN-1.6** stale-skip path (>48h) raises `late-data` (sensor flag `alert_state.late_data_open` written only when the notice is created, so late bursts don't hammer the sensor doc); a sample <1h late clears the flag in-tx and auto-resolves post-commit. **FN-2.4** `[perf] windowReads=… smoothedAxes=… computeMs=…` per invocation + `system-metrics/firebase-functions/daily/{date}.smoothingReads` increment (post-commit, failures caught). Alert/settle paths now preserve `ref` / `suspectSince`. Fixed a latent crash: a partial `alert_state` now merges defaults field-by-field (same defensive fix applied to the DIN read; DIN behavior unchanged). |
| `src/setBaseline.ts` (new) | **FN-1.2** `applyBaseline` (exported for tests/scripts) + `setBaseline` v2 callable. Role check: `admin === true` OR `installer === true` OR `role === 'installer'` (**assumption — confirm the real field**). `initial` omitted → per-axis **median of raw values** in the 24h after `time` (time omitted → the 24h before now); excludes replay/derived but **includes suspect samples on purpose** — after a device moves, the recent "suspect" level IS the new baseline (filtering it would make auto-initial fail exactly when the feature is needed). Writes the event, mirrors `initial-value`, resets `status.axes` → ok and `alert_state.axes` → {} (ref, suspectSince, throttle times), resolves the sensor's open notices with `baseline`. |
| `src/detectLevelShifts.ts` (new) | **FN-1.4** v2 schedule, 02:00 Asia/Jerusalem, 1GiB / 540s. Port of handbook `ops/src/analysis/level-shifts.ts`: active projects → non-vibration sensors with warn gaps → 7d daily medians (Asia/Jerusalem days, ≥2 values/day, excluding suspect/replay/derived/`daily::`) → step > 3 × warn gap persisting 2 days → `level-shift` warning notice ("possible device move / replacement / mapping change — set a new baseline"), deduped per sensor+axis. Logs projects / sensors scanned / doc reads / duration. `runDetectLevelShifts` exported for tests. |
| `scripts/migrate-baseline-events.js` (new) | **FN-1.3** dry-run by default, `--apply` to write; prints counts, 10 examples, and sensors with initial-value but no data. |
| `scripts/test-phase1-emulator.js` (new) | Acceptance suite; refuses to run unless `FIRESTORE_EMULATOR_HOST` is set. |
| `src/shared-status-types/shared-types.ts` | `AxisAlertState` gains `ref?`, `suspectSince?`; `SensorAlertState` gains `late_data_open?`. |
| `src/index.ts` | Exports `setBaseline`, `detectLevelShifts`. |
| `firestore.indexes.json` (functions repo) | Added `data-integrity (dedupeKey ASC, status ASC)` and `(sensorId ASC, status ASC)`. |
| `firestore.rules` (**web-platform** repo — the deployed lineage) | Added `data-integrity` block (admin read, `write: if false`) — **not effective while the deployed catch-all exists**, see §5. |

### Final shapes

**Sample write-back** (one update per sample, by the evaluator only):
```jsonc
{ "suspect": true, "suspect_reason": "implausible-jump|out-of-range", "suspect_axis": "x",   // only when flagged
  "smooth": { "<axis>": 0.121, "n": 11, "replayN": 0, "v": 1 },
  "eval":   { "<axis>": "ok|warn|alarm|suspect" } }
```
`smooth.n` = max per-axis used count. `replayN` = replay docs **excluded** from the window (the task spec drops them from the computation, so "used" would always be 0 — I store the excluded count as the useful signal; flag if you want it differently).

**`alert_state`** gains:
```jsonc
{ "axes": { "<axis>": { "ref": 0.107, "suspectSince": null, /* + Phase 0 fields */ } },
  "late_data_open": false }
```

**`data-integrity` / `baseline-events`**: exactly per the shared contract.

---

## 2. Acceptance results (emulator, 33 checks, all ✅)

| # | Case | Result |
|---|---|---|
| 1 | Tilt jump 2.1° vs ref → sample suspect (`implausible-jump`, `eval.x='suspect'`), **0 alerts**, 1 open notice; 5 repeats → same doc **count=6**; normal sample → `suspectSince` cleared, notice resolved `auto`, eval+smooth resume | ✅ |
| 2 | Sensor stuck at 9° for 38h of sample time → still suspect, **ref stayed ≈0.1** (persisted ref, not window); `setBaseline` (auto-initial = median of last 24h ≈ 9) → event written, `initial-value` mirrored, status ok, `alert_state.axes` reset, notices resolved `baseline`; next sample evaluates ok | ✅ |
| 3 | Window [1..10, +100, −100, trigger 5.5]: MAD rejects both outliers, trimmed mean = **5.5**, `n=11` — matches an independently-computed value exactly; 2-sample window → no smooth, eval still written | ✅ |
| 4 | setBaseline round-trip | ✅ (part of case 2) |
| 5 | Seeded 7d step 0→10 → `detectLevelShifts` finds exactly 1 step → 1 open `level-shift` warning notice (run stats: 1 project, 1 sensor, 23 reads, ~50ms) | ✅ |
| 6 | 49h-late sample → `late-data` notice + `late_data_open` flag; fresh sample → resolved `auto`, flag cleared | ✅ |
| 7 | **0 alert docs** on all suspect/late/smoothing sensors (⇒ 0 handleAlerts sends; emulator also has no subscribed users). The level-shift sensor correctly produced 1 raw-rule alert — Phase 0 behavior intentionally unchanged | ✅ |
| 8 | Migration dry-run vs prod (read-only) | ✅ see §4 |

---

## 3. Window reads per sample & daily volume (measured in prod, read-only)

22 active projects, 272 thresholded sensors, 141 with data in the last 24h. Window reads per sample ≈ samples/day:

| Type | sensors | median/day | max | est. daily reads (Σn²) |
|---|---|---|---|---|
| tilt | 18 | 22 | 72 | 24,537 |
| crack | 23 | 23 | 24 | 11,228 |
| OPKON_100 Pot. | 1 | 72 | 72 | 5,184 |
| cracktemp | 6 | 26 | 26 | 3,905 |
| prism | 80 | 4 | 17 | 3,763 |
| others (OPKON_60, battery, loadcell) | 13 | 22–23 | — | 4,540 |

**Total ≈ 53k reads/day ≈ $0.03/day** — well within budget; no need for the rolling-buffer sidecar fallback (plan §4.3).

---

## 4. Migration dry-run (prod, read-only)

811 sensors → **728 events would be created**; 83 no/empty `initial-value`; 0 already migrated; 0 with initial-value but no data. Ready for your `--apply`.

Oddities found:
- One straingage (`1jBc3b7QC5ztc0hXpJIm`) has first-sample `time` = **1970-01-01** (epoch-seconds bug in old data). The migration would write it as-is — harmless (adjusted-value lookup takes the latest event ≤ sample time), but say the word if you want a sanity floor.
- Some prism initials carry legacy `daily2Ddisplacement` / `dailySettlement` keys — mirrored as-is.

---

## 5. firestore.rules / indexes — findings (⚠️ read before deploying anything)

1. **The deployed ruleset (released 2026-01-20) matches NEITHER repo.** It is based on web-platform's `firestore.rules` **plus uncommitted "mobile app" rules**: `family_calibrations` / `device_calibrations` / `calibration_templates` open to the world, the committed `projects` rules commented out, and — ⚠️ — **`match /projects/{id} { allow read, write: if true }`** (unauthenticated, world-writable). A `firebase deploy --only firestore:rules` from either repo would silently drop these (good for security, would break the Flutter app).
2. **Deployed catch-all** `match /{document=**} { allow read, write: if request.auth != null }` → any authenticated user can read/write `data-integrity` (and any unmatched collection). Firestore rules are allow-only, so the explicit `data-integrity` block I added to web-platform's file **documents intent but is not effective** until the catch-all is narrowed. Recommend a separate task: reconcile the deployed mobile rules into git, then narrow the catch-all.
3. **web-platform's `firestore.indexes.json` is empty while prod has 15 composite indexes** — never deploy indexes from that repo. The two new `data-integrity` indexes are recorded in the **functions repo's** indexes file; for deployment create them **additively via gcloud** (zero deletion risk).

---

## 6. Suspect-default unit check (prod data)

| Type | Units observed | Default applied | Verdict |
|---|---|---|---|
| tilt | degrees (values ±2, warn 0.1–3) | jump 1° on x/y | ok |
| crack (incl. OPKON-hardware sensors *typed* `crack`) | mm (values 5–48, warn 0.3–1.5) | jump 5 mm on x | ok |
| cracktemp | x = mm (some warn **±0.1**), y = °C | jump 5 mm on **x only** | safe but loose for the ±0.1 sensors (catches only gross errors); y correctly excluded |
| prism | mm | jump 100 mm on the 4 displacement axes | ok |
| `OPKON_*_Potentiometer` (as a type) | mixed! some mm (warn 0.3), one **celsius** | **none** (config-only) | blanket default would misfire — confirm if you want x-only defaults |
| loadcell | inconsistent (x≈627 vs warn ±1; elsewhere ±8300) | **none** | correct call |

---

## 7. Deploy plan (after approval) & rollback

1. **Indexes first, additively via gcloud** (the dedupe queries fail without them; the emulator doesn't enforce indexes):
   ```bash
   gcloud firestore indexes composite create --collection-group=data-integrity \
     --field-config field-path=dedupeKey,order=ascending --field-config field-path=status,order=ascending
   gcloud firestore indexes composite create --collection-group=data-integrity \
     --field-config field-path=sensorId,order=ascending --field-config field-path=status,order=ascending
   ```
   Wait for READY.
2. `firebase deploy --only functions:checkThresholds,functions:setBaseline,functions:detectLevelShifts`
3. Migration: Hillel runs `node scripts/migrate-baseline-events.js --apply` (728 events).
4. **Rules: do not deploy** until the §5 drift is decided.

**Rollback:** redeploy the previous commit for `checkThresholds` (all new fields are additive; `smooth`/`eval` on samples are inert for old code); delete `setBaseline` / `detectLevelShifts` if needed; `data-integrity` is a standalone collection.

---

## 8. Open questions (answered — see "Handbook review" below)

1. **Rules drift (§5):** open a separate task to reconcile the deployed mobile-app rules into git and narrow the catch-all? That's also the only way to actually protect `data-integrity` and fix the world-writable `projects`.
2. **Installer role:** I guessed `installer === true || role === 'installer'` on the users doc — what's the real field?
3. **OPKON / loadcell suspect defaults:** leave config-only (current), or add x-only defaults?
4. **`replayN` semantics:** stored as replay docs *excluded* from the window (task says drop them; the contract phrasing said "used") — confirm.
5. **1970-epoch first-sample times:** migrate as-is (current behavior) or clamp to a sane floor?

---

## Handbook review (2026-10-04)

Verified independently:
- `checkThresholds` is the only trigger on `data-log`, so the write-back can't fire anything else.
- The deployed Firestore ruleset (`2451a414…`, released 2026-01-20) really contains `match /projects/{projectId} { allow read, write: if true; }` and the authenticated catch-all. This is a security issue unrelated to this plan; tracked separately.
- The web UI has no installer role. Users carry `admin` / `isAdmin` (`auth.service.ts`).

Answers:
1. **Rules drift:** separate task (security), not part of this deploy. Don't deploy rules.
2. **Role:** admin only, `admin === true || isAdmin === true`; drop the installer guess.
3. **OPKON / loadcell:** config-only, as implemented.
4. **`replayN`** = excluded replay docs: OK.
5. **1970 first-sample times:** migrate as-is.

Notes:
- Prisms measure a median of 4 samples/day, so a 24h window often has ≤ 4 points. Decision §8.1 pending (48h for prisms).
- Deploy order as proposed: indexes via gcloud → the three functions → Hillel runs the migration `--apply`.

---

## 9. Review changes implemented (2026-10-04, post-review)

1. **`setBaseline` = admin only**: `caller.admin === true || caller.isAdmin === true` (same fields as the web UI's `auth.service.ts`); installer check removed.
2. **Diurnal coverage in `computeSmooth`** (new rule 5 in the contract): per axis, the MAD-kept samples must cover **≥ 3 of the 4 six-hour quarters** of the window, bucketed by offset from window start (`t − (t_sample − 24h)`), not clock time; otherwise no `smooth` for that axis (shadow `eval` still written). `smooth.q` = quarters covered. Window stays 24h for all types incl. prisms.
3. **Contract updated** in `tasks.md`: `smooth` shape now documents `q` and the `replayN` = *excluded replay docs* semantics.
4. **Emulator coverage cases added** (suite now **35/35 green**): 10 samples bunched within 8h → n passes the minimum but only 2 quarters → **no smooth**, eval written; the same 10 samples spread over ~23h → smooth written with `q = 4`. (Existing seeds in cases 1–3 re-spread to satisfy coverage.)

## 10. Delivery report

- **Indexes**: both `data-integrity` composites created additively via `gcloud firestore indexes composite create` — `(dedupeKey, status)` and `(sensorId, status)`, state **READY** before the functions deploy.
- **Deploy**: 2026-10-04 **15:24 UTC**, `firebase deploy --only functions:checkThresholds,functions:setBaseline,functions:detectLevelShifts` as scanin.link@gmail.com — `checkThresholds` updated, `setBaseline` + `detectLevelShifts` created, 0 errors.
- **Commit**: **`26c99a5`** (Phase 1 in one commit, incl. migration + test scripts and the functions-repo indexes file), pushed to `master`. The `scanin-web-platform/firestore.rules` edit (data-integrity block + catch-all warning) is **left uncommitted** — handed to the web-platform team with the rules-drift task.
- **First-10-min sanity check**: executions `ok` (350ms–2.6s), zero errors; only the pre-existing DIN missing-frequency warning.
- **Pending**:
  - [x] Migration applied 2026-10-04 ~15:50 UTC (approved by Hillel): **728 events written**; verification dry-run shows 0 to create / 728 already migrated / 83 no-initial-value untouched. Idempotent — re-running is a no-op.
  - [x] **Log reviews done** (see functions-phase2.md §9.4 + §9.6 for the full numbers): 0 errors in every window since the 15:24 deploy; 71 samples evaluated in the first 1.5h, 100% with smooth; overnight 829 samples, per-type smooth 83–100% (loadcell 53%, min-n); `data-integrity` = 6 open `late-data` notices only (FN-1.6 working — two sensors draining ~2-month backlogs).
  - [x] `detectLevelShifts` first run 02:00 Asia/Jerusalem: 22 projects, 257 sensors, 13,308 reads, 0 steps, 61.6s — clean.
