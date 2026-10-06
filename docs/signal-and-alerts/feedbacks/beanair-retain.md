# Feedback: `scanin-svc-beanair-vibration-processor`: stop publishing retained

**Date:** 2026-10-06
**Repo:** [scanin-svc-beanair-vibration-processor](https://github.com/ScanInLtd/scanin-svc-beanair-vibration-processor)
**Status:** implemented as **`042024a`**, pushed to `origin/master` 2026-10-06 together with **`f2be24e`**, a deploy-script fix (see §3). **Deployed to the Windows host 2026-10-06** (Hillel). Broker retained-message check (§4) still pending. The broker's retained messages were already cleared by the broker side on 2026-10-06, and this change doesn't touch them.
**Trigger:** `MqttSSL.PublishAsync(topic, payload, bool retainFlag = true, int qos = 1)`. Every vibration sample (`ScaninVibration`) and every notification (`beanair/vibration/notif/<mac>`) went out retained. The broker kept the last message per topic and re-delivered it to the bridge on every (re)subscribe. Results: duplicate vibration samples, possibly duplicate DIN alerts, and notifications stored again with today's date.

---

## 1. What changed

| File | Change |
|---|---|
| `MqttSSL/MqttSSL.cs` | `PublishAsync` now defaults to `retainFlag = false`. QoS stays at 1. |

That's the whole diff (one line).

**Call sites.** Every publish in the repo goes through `PublishAsync`, and none of them pass `retainFlag`, so all of them are now non-retained:

| Caller | Path | Topic |
|---|---|---|
| `BeanairAdapter.cs:342` | `MqttSSL.AddMessage` → `PublishAsync` | `ScaninVibration` |
| `BeanairAdapter.cs:501` | `MqttSSL.AddNotifMessage` → `PublishAsync` | `beanair/vibration/notif/<mac>` |
| `BackfillWorker.cs:239` (`--backfill`) | `MqttSSL.AddMessage` → `PublishAsync` | `ScaninVibration` |

There's no other `mqttClient.PublishAsync` or `WithRetainFlag` in the repo (grep-checked). Backfill shares the static `MqttSSL` client (client ID suffix `-backfill`), so it follows the same path and is non-retained too.

## 2. Build

There's no .NET Framework toolchain on the dev Mac, so nothing was compiled locally. The change only edits a default value, with no signature or call-site changes. The real build is step 4 of `redeploy.bat` (msbuild Release) on the Windows host. A build failure there stops the script before the service is reinstalled.

## 3. Deploy

The first `redeploy.bat` attempt failed at `git pull` with "not a git repository". Right-click → *Run as administrator* starts batch files in `C:\Windows\System32`, not in the script's folder. By then the script had already stopped the service. Commit `f2be24e` adds `cd /d "%~dp0"` to `redeploy.bat` and `run-backfill.bat` (both use relative paths). The copy of `redeploy.bat` on the host only gets this fix after one pull, so the first run has to start from an admin prompt already in the repo folder.

The second attempt only worked from a **Developer Command Prompt for VS run as Administrator**. Plain cmd and PowerShell fail because `msbuild` is only on PATH there. This is now documented in the repo's `DEPLOYMENT.md`.

1. Push to `origin/master` (done: `042024a`, `f2be24e`).
2. On the Windows host (`C:\Users\user\Documents\GitHub\ScaninVibrationService`), run `redeploy.bat` **as Administrator**. It stops the service, runs `git pull origin master`, restores NuGet, builds Release, reinstalls with InstallUtil, starts the service and checks for `RUNNING`.
3. Run `.\status` as a health check.

Rollback: `git revert 042024a`, push, then `redeploy.bat`.

## 4. Verification (after deploy)

After a few minutes of traffic, ask the broker for retained messages. Retained messages are delivered right after subscribing, so a short-lived subscriber that prints only retained messages works. Run it from somewhere with broker credentials (the bridge VM, or with the creds from `MqttSSL/appsettings.json` on the Windows host):

```sh
mosquitto_sub -h <broker> -p 8883 --cafile <ca> -u <user> -P <pass> \
  -t 'ScaninVibration' -t 'beanair/vibration/notif/#' \
  --retained-only -v -W 5
```

Expected: no output, then exit on the 5 s timeout. Any line printed is a retained message, which would mean the old build is still running or some other publisher retains.

Result: _pending deploy._

## 5. Not addressed (flagging)

- **Clearing the broker:** not done here, as instructed. The broker side already did it on 10-06. Publishing non-retained doesn't remove an existing retained message, so if one shows up before the deploy (old build still running), it has to be cleared again after the deploy.
- **QoS 1 is still at-least-once.** On a reconnect with a persistent session, unacked messages can still arrive twice. That's much rarer than the retained replay, but the bridge should still dedupe (e.g. sample doc ID from mac + axis + sample timestamp, not receive time).
- **Notification date:** the bridge stamping notifications with "today" suggests it uses receive time, not a timestamp from the payload. Once retain is off, that matters less, but it's worth checking in `beanairVibrationHandler`.
- **Duplicates already stored** (samples, DIN alerts, notifications from earlier replays) are left as they are. A oneoff in `ops/` could find and remove them if wanted.

---

# Part 2: startup replay (persisted publish watermark)

**Date:** 2026-10-06
**Status:** `115433c` + `7792af0` pushed to `origin/master`. `115433c` compiled on the host (first deploy attempt failed at the copy step, see §2.6). **Deploy in progress.**
**Trigger:** after the 10-06 redeploy (12:00–12:02Z), 13 vibration sensors received copies of old samples. SAVYON "1 רעידות" now has the same sample stored 55×. The same pattern appears at 2026-08-31 06:25Z and 2026-09-14 07:04Z (earlier restarts). Each copy opens a "late data" notice in the internal WhatsApp group.

## 2.1 Where the replay comes from

It isn't a BeanAir SDK cache and it isn't a deliberate startup loop. The service has no SDK: it only reads the text files that BeanScape writes under `C:\log_beanscape\<sensor>\`. The replay happens because **the "already sent" cursor exists only in memory**, so it resets to "nothing sent" on every start:

| State (in-memory) | `BeanairAdapter.cs` | After a restart |
|---|---|---|
| `SensorFolder.last_files[axis]` (current PVR file per axis) | `Check()` | `null` → the newest `*CH_<axis>_*` file counts as a NEW FILE (`bHasModified = true`). |
| `PPV_File.lineIndex` (read position in that file) | `GetLastBatches()` | `0` → the **whole file** is read from the top. `GetMessages()` then builds a short-term message (the most severe line of the file) plus long-term messages (every line with severity > 0, plus the fastest line). These are old reads that were already published. |
| `SensorFolder.lastHandledNotifFile` | `CheckAndHandleNotifFiles()` | `null` → the newest `Notif_*.txt` per sensor is parsed and published again. |

The first round runs 2 minutes after start (`INTERVAL_MS`), which matches the 12:00–12:02Z window. The re-sent samples keep their original timestamps, so the bridge and functions see them as late data.

**About 55×:** each restart only re-sends the current file's reads once, so the three restarts listed can't produce 55 copies on their own. Two other candidates:
- (a) Other restarts, such as Windows reboots or the service restarting after a crash. An `async void` publish lambda that throws while disconnected would crash the process. Check Event Viewer → `Scanin_Vibration_Log` for `In OnStart`.
- (b) The retained message (Part 1). There is only one retained message for the whole `ScaninVibration` topic. If that last message was SAVYON's, every bridge reconnect re-delivered that one sample.

The `createdAt` times of the 55 copies would tell these apart. That would be a read-only query; I haven't run it.

## 2.2 What changed

| File | Change |
|---|---|
| `ScaninBridgeService/PublishWatermarks.cs` (new, added to the csproj) | Watermark per key: last published read time in **true UTC ms**, persisted to `C:\Program Files\VibrationService\publish-watermarks.json` (next to `logpath.dat`; the service runs as LocalSystem). Writes are atomic (tmp + `File.Replace`). Keys: `sample\|<mac>\|<axis>\|<short\|long>` and `notif\|<mac>`. |
| `BeanairAdapter.cs`, `PPV_File` | New `NewReads()`: parses the lines, then **drops every read with time ≤ the watermark** before the short/long selection runs. Returns one `MsgBatch` per key (messages + newest read time). The short/long selection rules are unchanged; they just run on the new reads only. Unparseable lines are skipped. |
| `BeanairAdapter.cs`, `SensorFolder.GetAndSendNewReads()` | Applies `VibrationFilter` as before, then enqueues. The watermark is **committed to disk once every message of the batch has been published**, via a callback after `PublishAsync`. If the filter drops all of a batch, it's committed right away. An in-memory "claimed" value stops re-enqueueing within the same process. |
| `BeanairAdapter.cs`, notifications | A notification is published only if its `Date` (→ `timestamp`) is newer than `notif\|<mac>`. If there's no `Date`, the file's creation time is used. Skips are logged. |
| `MqttSSL.cs` | `AddMessage` / `AddNotifMessage` take an optional `Action onPublished`, which runs after a successful publish. |
| `VibrationService.cs` | `PublishWatermarks.Load()` runs in `OnStart` before the worker starts. |

**Design notes:**
- The check applies **always**, not only at startup. It also covers a smaller steady-state duplicate: `GetLastBatches` re-reads the last line of the previous batch.
- **Granularity is per device + axis + short/long.** A single per-device watermark would drop valid reads: axis Y is processed after axis X in the same round and can have slightly older timestamps.
- **Filtering is by read, not by message.** Within a batch, long-term messages aren't in time order (the fastest read is appended last). After a restart, the "most severe / fastest" selection should cover only the unpublished reads.
- **Watermarks use UTC, not the payload's naive local-time ms.** BeanScape writes naive PC-local times. Comparing them as-is would drop an hour of data at every DST fall-back; the next one in Israel is 2026-10-25. Times in the repeated hour are resolved to the earliest reading newer than the watermark. **Payloads are unchanged:** `timestamp` keeps its existing format.
- **The watermark is committed only after publish.** If MQTT is down and the service restarts, the reads that were queued in memory were never published. They are sent after the restart, and they aren't duplicates.
- **`--backfill` is untouched.** `BackfillWorker` calls `MqttSSL.AddMessage(msg)` with no callback, never reads or advances watermarks, and keeps logging as before.

## 2.3 First start after deploy (bootstrap)

The watermark file doesn't exist yet, so the service can't know what was already published. With no file (or an unreadable one), every key gets seeded with the **service start time** the first time it's seen, and that is saved. So the deploy itself doesn't replay. The cost is that reads BeanScape wrote **while the service was stopped during this deploy** (a few minutes) are skipped once. This is logged: `Watermarks: no usable file - BOOTSTRAP…` and `seeded <key>`. Later starts load the file. A sensor first seen after that (new device) has no watermark and is published in full, as before.

## 2.4 Verification

- **Compile:** not done locally. There's no .NET Framework, Mono or dotnet on the Mac, and Docker wasn't running. `redeploy.bat` builds before reinstalling, but it **has already stopped the service at that point**. If the build fails, start the old build with `sc start ScaninVibrationService`.
- **After deploy** (Event Viewer → `Scanin_Vibration_Log`, first round about 2 min after start):
  1. `Watermarks: no usable file - BOOTSTRAP…`, then `seeded sample|…` / `seeded notif|…` per key, then `Watermark: skipped N already-published … reads`, and **no `mqtt msg >` with old timestamps**.
  2. `C:\Program Files\VibrationService\publish-watermarks.json` exists and its values advance as new reads are published.
  3. Restart the service again (`sc stop` / `sc start`). The log should say `Watermarks: loaded N keys` and `skipped …`, and no samples should be re-sent. Firestore: no new copies of old samples on the 13 sensors, and no "late data" notices in the WhatsApp group around the restart.

## 2.5 Limits / not addressed

- **Equal timestamps:** a read with exactly the same timestamp as the last published one for that key is dropped (the rule is "skip ≤"). BeanScape files sometimes contain several lines with the same millisecond timestamp. Within one batch they're all kept; this only matters across a batch boundary.
- **No publish retry** (existing behaviour). If a publish fails, its batch isn't committed. Committing a later batch for the same key still moves the watermark past it.
- **Duplicates already stored** (the 55 SAVYON copies and the other 12 sensors) are untouched. A oneoff in `ops/` could find and remove them.
- **Steady-state reads after the first pass** (existing behaviour, not changed): `GetLastBatches` starts each incremental read with an unknown section type, so appended lines are picked up only when a new block with a section header is appended.

## 2.6 Deploy finding: the process outlives "service stopped" (`7792af0`)

The first deploy of `115433c` **compiled cleanly** (warnings only, no CS errors). It failed at the copy step: `bin\Release\SubscriberSSL.dll` was locked by `ScaninVibrationService (6848)`, although the SCM reported the service as STOPPED.

**Cause:**
- `VibrationService.OnStop()` only wrote a log line.
- The `BeanairAdapter` worker loop and the `MqttSSL` publish loop are **foreground** threads, so they keep the process alive after `ServiceBase.Run` returns.
- After every `sc stop`, the old process **kept running: it read the files and published to MQTT** under client ID `ScaninVibrationService`, while the SCM considered it stopped.
- `redeploy.bat` force-killed only when the SCM state wasn't STOPPED, so the old process survived.

This may also have contributed to past duplicates. If an earlier lingering process was still alive when the new one started, both published (and fought over the same MQTT client ID). That isn't proven.

**Fix (`7792af0`, pushed):**
- Both loop threads are now `IsBackground = true`.
- `OnStop` calls `worker.Stop()`.
- `redeploy.bat` step 1 checks the **process** (`tasklist`) and force-kills it if it's still alive. Note that this would also kill a running `--backfill`, which uses the same exe.

The copy of `redeploy.bat` on the host only gets this fix after a pull. For this run, kill the process by hand first.
