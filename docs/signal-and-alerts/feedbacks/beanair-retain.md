# Feedback: `scanin-svc-beanair-vibration-processor`: stop publishing retained

**Date:** 2026-10-06
**Repo:** [scanin-svc-beanair-vibration-processor](https://github.com/ScanInLtd/scanin-svc-beanair-vibration-processor)
**Status:** implemented as **`042024a`**, pushed to `origin/master` 2026-10-06 together with **`f2be24e`**, a deploy-script fix (see §3). **Deploy to the Windows host is in progress.** The broker's retained messages were already cleared by the broker side on 2026-10-06, and this change doesn't touch them.
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
