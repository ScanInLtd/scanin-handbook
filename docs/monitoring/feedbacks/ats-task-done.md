# ATS Email Ingestion — Heartbeat Implementation: Done

## Summary

Implemented heartbeat write to `system-heartbeats/ats-ingestion` as specified in `ats-task.md`.

## What Was Done

### Changes to `Program.cs`

1. **Added `using Google.Cloud.Firestore;`** import (line 18)
2. **Added `totalEmailsFailed` counter** (line 89) — incremented in the email processing catch block
3. **Heartbeat call at all exit paths:**
   - After "no emails found" early return (line 149)
   - After "no links extracted" early return (line 199)
   - After normal full processing cycle (line 339–344)
4. **Added `WriteHeartbeatAsync` method** (lines 521–553) — static method in `Program` class

### Heartbeat Document Written

**Path:** `system-heartbeats/ats-ingestion`  
**Operation:** Full overwrite via `.SetAsync()`

Fields:
- `schemaVersion`: 1
- `serviceName`: "ats-ingestion"
- `lastSeenAt`: FieldValue.ServerTimestamp
- `version`: "1.0.0"
- `host`: Environment.MachineName
- `status`: "healthy" or "warning" (if any emails failed)
- `lastEmailCheckAt`: FieldValue.ServerTimestamp
- `emailsFoundLastRun`: count of emails found
- `emailsProcessedLastRun`: count of reports successfully processed
- `emailsFailedLastRun`: count of emails that threw exceptions
- `sensorsUpdatedLastRun`: count of sensor points updated
- `lastInsertionAt`: FieldValue.ServerTimestamp (only if sensorsUpdated > 0)

### Design Decisions

- Heartbeat is written on **every** exit path (including "no emails" — proves service is alive)
- Heartbeat failure is caught and logged but **does not crash** the service
- Reuses same project ID (`dataloggerdev`) and credentials already set in `GOOGLE_APPLICATION_CREDENTIALS`
- No new NuGet dependencies (already has `Google.Cloud.Firestore`)

## Testing Checklist

- [ ] Deploy to Natan's PC
- [ ] Run the service — verify `system-heartbeats/ats-ingestion` doc appears in Firestore
- [ ] Confirm `lastSeenAt` updates each cycle
- [ ] Confirm `status` = "healthy" on normal runs
- [ ] Stop service — confirm watchdog alerts fire after threshold (2h warning / 6h critical)

## No Breaking Changes

The heartbeat is additive — existing email processing and Firestore data ingestion logic is untouched.
