# ATS Email Ingestion — Heartbeat Implementation Task

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

Local path (if cloned): `../scanin-handbook/docs/monitoring/`

---

## What This Service Is

`ATS Email Ingestion` is a C# .NET service running on **Natan's PC**. It:
1. Periodically checks a mailbox for new Hexagon ATS survey emails
2. Parses email attachments (CSV/data files) using a non-headless browser
3. Writes parsed prism/settlement data to Firestore (`work-sensors/{id}/data-log/{entry}`)

It already has Firestore access (writes sensor data).

---

## What To Add

A single heartbeat write after each email check cycle (whether or not emails were found).

### Heartbeat Document

**Doc path:** `system-heartbeats/ats-ingestion`  
**Operation:** Overwrite (`.SetAsync()` with merge or full overwrite)

```csharp
// After each email check cycle, write:
{
    "schemaVersion": 1,
    "serviceName": "ats-ingestion",
    "lastSeenAt": FieldValue.ServerTimestamp,  // Firestore server timestamp
    "version": "1.0.0",  // or from assembly version
    "host": "natans-pc",
    "status": "healthy",  // or "warning" or "error"

    "lastEmailCheckAt": FieldValue.ServerTimestamp,
    "emailsFoundLastRun": 3,          // how many new emails found this cycle
    "emailsProcessedLastRun": 3,      // how many successfully parsed
    "emailsFailedLastRun": 0,         // how many failed to process
    "lastInsertionAt": <timestamp>,   // last successful Firestore write (null if none this run)
    "sensorsUpdatedLastRun": 12       // how many sensors got new data points
}
```

### Status Logic

```csharp
string ComputeStatus()
{
    if (emailsFailedLastRun > 0) return "warning";
    // Could add: if (!canConnectToMailbox) return "error";
    return "healthy";
}
```

---

## Where To Add Code

Look for the main loop / timer that triggers email checks. After each cycle completes (success or failure), write the heartbeat. Pseudocode:

```csharp
// In the main check cycle method:
async Task CheckForEmails()
{
    var emailsFound = 0;
    var emailsProcessed = 0;
    var emailsFailed = 0;
    var sensorsUpdated = 0;

    try
    {
        // ... existing email check logic ...
        // Count results as you go
    }
    catch (Exception ex)
    {
        // ... existing error handling ...
    }
    finally
    {
        // ALWAYS write heartbeat, even on failure
        await WriteHeartbeatAsync(emailsFound, emailsProcessed, emailsFailed, sensorsUpdated);
    }
}
```

### Heartbeat Writer

```csharp
private async Task WriteHeartbeatAsync(int found, int processed, int failed, int sensorsUpdated)
{
    try
    {
        var db = FirestoreDb.Create("dataloggerdev"); // or reuse existing instance
        var docRef = db.Collection("system-heartbeats").Document("ats-ingestion");

        var data = new Dictionary<string, object>
        {
            ["schemaVersion"] = 1,
            ["serviceName"] = "ats-ingestion",
            ["lastSeenAt"] = FieldValue.ServerTimestamp,
            ["version"] = "1.0.0",
            ["host"] = Environment.MachineName,
            ["status"] = failed > 0 ? "warning" : "healthy",
            ["lastEmailCheckAt"] = FieldValue.ServerTimestamp,
            ["emailsFoundLastRun"] = found,
            ["emailsProcessedLastRun"] = processed,
            ["emailsFailedLastRun"] = failed,
            ["sensorsUpdatedLastRun"] = sensorsUpdated
        };

        // Add lastInsertionAt only if we actually wrote data
        if (sensorsUpdated > 0)
            data["lastInsertionAt"] = FieldValue.ServerTimestamp;

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
2. **Heartbeat write must be try/catch** — if Firestore is down, the service must keep checking emails
3. **Overwrite, don't accumulate** — always `.SetAsync()` the same doc
4. **Write after EVERY cycle** — even if no emails found (proves the service is alive and checking)

---

## Dependencies

The service already uses Firestore (writes sensor data). No new NuGet packages needed. Just needs access to the `system-heartbeats` collection (same project, same credentials).

If for some reason the existing Firestore instance doesn't have write access to `system-heartbeats`, it's because it's a new collection — but same database, same credentials should work.

---

## Testing

After deployment:
1. Check Firestore console → `system-heartbeats/ats-ingestion` doc exists
2. `lastSeenAt` updates after each email check cycle
3. `emailsFoundLastRun` reflects actual results
4. Stop the service → doc stops updating → watchdog will alert after 2h (warning) / 6h (critical)
5. Send a test email → next cycle should show `emailsFoundLastRun: 1`

---

## Estimated Effort

~20 lines of C# code. No new dependencies. No architectural changes.
