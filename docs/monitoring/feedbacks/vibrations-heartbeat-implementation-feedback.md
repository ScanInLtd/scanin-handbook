# Heartbeat Implementation — Feedback Report

**Date:** 2026-05-19  
**Service:** Vibration Processor (`scanin-svc-beanair-vibration-processor`)  
**Task:** Add Firestore heartbeat to `system-heartbeats/vibration-processor`

---

## What Was Done

### 1. NuGet Migration (packages.config → PackageReference)

Both projects were migrated from the legacy `packages.config` format to `PackageReference` in the `.csproj`. This allows automatic transitive dependency resolution (same approach as the Hexagon ATS service).

**Why:** Adding `Google.Cloud.Firestore` with `packages.config` requires manually listing ~30+ transitive packages. With `PackageReference`, it's a single line and NuGet resolves the rest automatically.

**Changed files:**
- `MqttSSL/MqttSSL.csproj` — converted to PackageReference
- `ScaninBridgeService/ScaninVibrationService.csproj` — converted to PackageReference + added `Google.Cloud.Firestore 3.2.0`
- Deleted: `MqttSSL/packages.config`, `ScaninBridgeService/packages.config`

### 2. HeartbeatWriter Implementation

New file: `ScaninBridgeService/HeartbeatWriter.cs`

- Static class, initialized once at service start
- Writes to `system-heartbeats/vibration-processor` via `SetAsync()` (overwrite)
- Uses `FieldValue.ServerTimestamp` for `lastSeenAt` and `lastCheckAt`
- All writes wrapped in try/catch — heartbeat failure never crashes the service
- If credentials file is missing, heartbeat is silently disabled (service still runs normally)

### 3. Integration Points

- **`VibrationService.OnStart()`** — calls `HeartbeatWriter.Initialize()`
- **`BeanairAdapter.Loop()`** — calls `HeartbeatWriter.WriteAsync()` after every 2-minute processing cycle

### 4. Redeploy Script Update

`redeploy.bat` now has 6 steps (added NuGet restore):
1. Stop service
2. Git pull
3. **NuGet restore** (`msbuild /t:Restore`)
4. Build
5. Reinstall service
6. Start service

---

## Deployment Steps (on Monitoring PC)

### First-time setup (one-time):

1. **Copy the Firebase credentials file** to:
   ```
   C:\Users\user\Documents\GitHub\ScaninVibrationService\ScaninBridgeService\firebase-credentials.json
   ```
   Use the same service account JSON that ATS uses on this machine.  
   Check ATS folder: look for `firebase-credentials.json` or `Resources/firebase-credentials.json` in the Hexagon service folder.

2. **Run redeploy:**
   ```
   cd C:\Users\user\Documents\GitHub\ScaninVibrationService
   .\redeploy
   ```
   The new NuGet restore step will download `Google.Cloud.Firestore` and all dependencies automatically.

### Subsequent deploys:

Just `.\redeploy` as usual — restore is fast if packages are already cached.

---

## Verification

After deployment:

1. **Check Firestore Console** → `system-heartbeats/vibration-processor` document should appear
2. **Verify `lastSeenAt`** updates every ~2 minutes
3. **Check Event Viewer** → `Scanin_Vibration_Log` should show:
   ```
   Heartbeat: Firestore connected to project 'dataloggerdev'.
   ```
4. **If credentials are missing**, log will show:
   ```
   Heartbeat: No firebase-credentials.json found and GOOGLE_APPLICATION_CREDENTIALS not set. Heartbeat DISABLED.
   ```
   The service still runs normally — only heartbeat is skipped.

---

## Heartbeat Document Schema

**Path:** `system-heartbeats/vibration-processor`

| Field | Type | Description |
|---|---|---|
| `schemaVersion` | number | Always `1` |
| `serviceName` | string | `"vibration-processor"` |
| `lastSeenAt` | timestamp | Server timestamp, updated every cycle |
| `version` | string | `"1.0.0"` |
| `host` | string | Machine name |
| `status` | string | `"healthy"` or `"warning"` |
| `lastCheckAt` | timestamp | Server timestamp, updated every cycle |
| `newSamplesFound` | number | Sensors checked this cycle |
| `samplesProcessed` | number | Sensors processed successfully |
| `samplesFailedLastRun` | number | Sensors that threw errors |
| `dinAlertsCreatedLastRun` | number | Always 0 (DIN alerts not yet tracked) |
| `lastProcessedAt` | timestamp | Set only when samplesProcessed > 0 |

---

## Risk Assessment

- **Low risk:** Heartbeat is completely isolated. If Firestore connection fails, it logs a warning and continues normal operation.
- **No breaking changes:** Existing MQTT and sensor processing logic is unchanged.
- **Rollback:** If anything goes wrong, remove the `HeartbeatWriter.Initialize()` call from `VibrationService.cs` line 67 and the `WriteAsync` call from `BeanairAdapter.cs` line 126.

---

## Open Items

- `dinAlertsCreatedLastRun` is always 0 — DIN threshold violation counting can be added later when that logic is identified in the codebase.
- The `firebase-credentials.json` placeholder in the repo needs to be replaced with the real service account key on the Monitoring PC.
