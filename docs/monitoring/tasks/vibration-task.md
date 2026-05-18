# Vibration Processor — Heartbeat Implementation Task

## Context

ScanIn is an IoT monitoring platform. All services self-report heartbeats to a shared Firestore collection. A Cloud Run watchdog reads these heartbeats and sends alerts if services go silent.

```
Services → system-heartbeats/{serviceName}  (Firestore, overwritten)
                     ↓
Cloud Scheduler → Watchdog (Cloud Run)
                     ↓
           Alerts (WhatsApp) + Incidents (Firestore)
```

Full design docs:
- [System Monitoring Design](https://github.com/ScanInLtd/scanin-handbook/blob/main/docs/monitoring/system-monitoring-design.md)
- [Per-Component Check Specs](https://github.com/ScanInLtd/scanin-handbook/blob/main/docs/monitoring/monitoring-checks.md)

---

## What This Service Is

`Vibration Processor` is a C# .NET service running on the **Monitoring PC**. It:
1. Receives vibration data from Beanair sensors via MQTT (through the broker)
2. Processes raw samples through MATLAB
3. Evaluates DIN 4150-3 compliance thresholds
4. Creates alerts in Firestore when violations are detected
5. Sends processed data to Firestore

**Note:** This service currently communicates via MQTT for receiving data. For the heartbeat, it will write directly to Firestore. Check if Firestore credentials/SDK are already present (the service may already write alerts to Firestore). If not, you'll need to add the `Google.Cloud.Firestore` NuGet package and a service account JSON key.

---

## What To Add

A single heartbeat write after each processing cycle (whether or not new samples were found).

### Heartbeat Document

**Doc path:** `system-heartbeats/vibration-processor`  
**Operation:** Overwrite (`.SetAsync()`)

```csharp
{
    "schemaVersion": 1,
    "serviceName": "vibration-processor",
    "lastSeenAt": FieldValue.ServerTimestamp,  // Firestore server timestamp
    "version": "1.0.0",  // or from assembly version
    "host": Environment.MachineName,
    "status": "healthy",  // or "warning" or "error"

    "lastCheckAt": FieldValue.ServerTimestamp,  // last time it checked for new samples
    "newSamplesFound": 5,            // raw samples found this cycle
    "samplesProcessed": 5,           // successfully processed
    "samplesFailedLastRun": 0,       // failed to process
    "dinAlertsCreatedLastRun": 1,    // DIN threshold violations detected
    "lastProcessedAt": <timestamp>   // last successful processing (null if none this run)
}
```

### Status Logic

```csharp
string ComputeStatus()
{
    if (samplesFailedLastRun > 0) return "warning";
    // Could add: if (matlabConnectionFailed) return "error";
    return "healthy";
}
```

---

## Where To Add Code

Look for the main loop / timer that triggers sample processing. After each cycle completes (success or failure), write the heartbeat.

```csharp
// In the main processing cycle:
async Task ProcessVibrationCycle()
{
    var samplesFound = 0;
    var samplesProcessed = 0;
    var samplesFailed = 0;
    var dinAlerts = 0;

    try
    {
        // ... existing processing logic ...
        // Count results as you go
    }
    catch (Exception ex)
    {
        // ... existing error handling ...
    }
    finally
    {
        // ALWAYS write heartbeat, even on failure
        await WriteHeartbeatAsync(samplesFound, samplesProcessed, samplesFailed, dinAlerts);
    }
}
```

### Heartbeat Writer

```csharp
private static FirestoreDb _firestoreDb;

private static FirestoreDb GetFirestoreDb()
{
    // Reuse existing instance if service already has Firestore access
    // Otherwise: set GOOGLE_APPLICATION_CREDENTIALS env var pointing to service account JSON
    _firestoreDb ??= FirestoreDb.Create("dataloggerdev");
    return _firestoreDb;
}

private static async Task WriteHeartbeatAsync(int found, int processed, int failed, int dinAlerts)
{
    try
    {
        var db = GetFirestoreDb();
        var docRef = db.Collection("system-heartbeats").Document("vibration-processor");

        var data = new Dictionary<string, object>
        {
            ["schemaVersion"] = 1,
            ["serviceName"] = "vibration-processor",
            ["lastSeenAt"] = FieldValue.ServerTimestamp,
            ["version"] = "1.0.0",
            ["host"] = Environment.MachineName,
            ["status"] = failed > 0 ? "warning" : "healthy",
            ["lastCheckAt"] = FieldValue.ServerTimestamp,
            ["newSamplesFound"] = found,
            ["samplesProcessed"] = processed,
            ["samplesFailedLastRun"] = failed,
            ["dinAlertsCreatedLastRun"] = dinAlerts
        };

        if (processed > 0)
            data["lastProcessedAt"] = FieldValue.ServerTimestamp;

        await docRef.SetAsync(data);
    }
    catch (Exception ex)
    {
        // Log but DO NOT crash the service
        Console.WriteLine($"Heartbeat write failed: {ex.Message}");
    }
}
```

---

## Critical Rules

1. **Use `FieldValue.ServerTimestamp`** for `lastSeenAt` — never `DateTime.UtcNow`
2. **Heartbeat write must be try/catch** — if Firestore is down, the service must keep processing
3. **Overwrite, don't accumulate** — always `.SetAsync()` the same doc
4. **Write after EVERY cycle** — even if no samples found (proves the service is alive)

---

## Dependencies

Check if the service already has:
- `Google.Cloud.Firestore` NuGet package → if not, add it
- `GOOGLE_APPLICATION_CREDENTIALS` env var → if not, copy the service account JSON key file (same one used by ATS on the same machine)

Since ATS has been moved to the same Monitoring PC, the Firestore credentials should already be available on this machine.

---

## Staleness Thresholds (for reference)

The watchdog checks this heartbeat with tighter thresholds than ATS because vibration processing is near-real-time:

| Check | Warning | Critical |
|---|---|---|
| `lastSeenAt` age | > 30 min | > 2h |
| `lastCheckAt` age | > 30 min | > 2h |

---

## Testing

After deployment:
1. Check Firestore console → `system-heartbeats/vibration-processor` doc exists
2. `lastSeenAt` updates after each cycle
3. `newSamplesFound` reflects actual data (may be 0 if no construction activity)
4. Stop the service → watchdog alerts after 30min (warning) / 2h (critical)

---

## Estimated Effort

~20–30 lines of C# code. If Firestore SDK already present: no new dependencies. If not: add NuGet package + credential file (same one as ATS on same PC).
