# Watchdog — Deploy to Cloud Run

## Context

The watchdog service code is complete (all tiers: critical, high, daily). It needs to be deployed to Cloud Run and triggered by Cloud Scheduler jobs.

WhatsApp alerts are **optional** — if `GREEN_API_SEND_MESSAGE_URL` is not set, the service should log a warning and skip sending. All other functions (checks, incidents, Firestore writes) work independently.

---

## Step 1: Create Service Account

In GCP project `dataloggerdev`:

```bash
# Create service account
gcloud iam service-accounts create watchdog-service \
  --display-name="Watchdog Service" \
  --project=dataloggerdev

# Grant Firestore read/write
gcloud projects add-iam-policy-binding dataloggerdev \
  --member="serviceAccount:watchdog-service@dataloggerdev.iam.gserviceaccount.com" \
  --role="roles/datastore.user"

# Grant Cloud Monitoring read (for Firebase Functions stats)
gcloud projects add-iam-policy-binding dataloggerdev \
  --member="serviceAccount:watchdog-service@dataloggerdev.iam.gserviceaccount.com" \
  --role="roles/monitoring.viewer"

# Grant Firestore Admin (for backup checks)
gcloud projects add-iam-policy-binding dataloggerdev \
  --member="serviceAccount:watchdog-service@dataloggerdev.iam.gserviceaccount.com" \
  --role="roles/datastore.viewer"
```

Optional (for bridge VM status check later):
```bash
gcloud projects add-iam-policy-binding monitoringbridge \
  --member="serviceAccount:watchdog-service@dataloggerdev.iam.gserviceaccount.com" \
  --role="roles/compute.viewer"
```

---

## Step 2: Deploy to Cloud Run

```bash
cd /path/to/scanin-svc-watchdog

gcloud run deploy scanin-svc-watchdog \
  --source . \
  --project dataloggerdev \
  --region us-central1 \
  --service-account watchdog-service@dataloggerdev.iam.gserviceaccount.com \
  --no-allow-unauthenticated \
  --set-env-vars "GCP_PROJECT=dataloggerdev"
```

**Optional** (add when WhatsApp group is ready):
```bash
gcloud run services update scanin-svc-watchdog \
  --project dataloggerdev \
  --region us-central1 \
  --set-env-vars "GREEN_API_SEND_MESSAGE_URL=https://...,GREEN_API_CHAT_ID=..."
```

---

## Step 3: Create Cloud Scheduler Jobs

The watchdog exposes `POST /check?tier=<tier>`. Create 3 scheduler jobs:

```bash
# Get the Cloud Run service URL
SERVICE_URL=$(gcloud run services describe scanin-svc-watchdog \
  --project dataloggerdev --region us-central1 --format='value(status.url)')

# Critical tier — every 5 minutes
gcloud scheduler jobs create http watchdog-critical \
  --project dataloggerdev \
  --location us-central1 \
  --schedule "*/5 * * * *" \
  --uri "${SERVICE_URL}/check?tier=critical" \
  --http-method POST \
  --oidc-service-account-email watchdog-service@dataloggerdev.iam.gserviceaccount.com \
  --oidc-token-audience "${SERVICE_URL}"

# High tier — every 15 minutes
gcloud scheduler jobs create http watchdog-high \
  --project dataloggerdev \
  --location us-central1 \
  --schedule "*/15 * * * *" \
  --uri "${SERVICE_URL}/check?tier=high" \
  --http-method POST \
  --oidc-service-account-email watchdog-service@dataloggerdev.iam.gserviceaccount.com \
  --oidc-token-audience "${SERVICE_URL}"

# Daily tier — 07:00 IST (04:00 UTC)
gcloud scheduler jobs create http watchdog-daily \
  --project dataloggerdev \
  --location us-central1 \
  --schedule "0 4 * * *" \
  --time-zone "Asia/Jerusalem" \
  --uri "${SERVICE_URL}/check?tier=daily" \
  --http-method POST \
  --oidc-service-account-email watchdog-service@dataloggerdev.iam.gserviceaccount.com \
  --oidc-token-audience "${SERVICE_URL}"
```

---

## Step 4: Verify

1. **Health check:**
   ```bash
   curl -H "Authorization: Bearer $(gcloud auth print-identity-token)" ${SERVICE_URL}/health
   ```
   Expected: `{ "status": "ok" }`

2. **Manual trigger (critical):**
   ```bash
   curl -X POST -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
     "${SERVICE_URL}/check?tier=critical"
   ```
   Expected: JSON with check results

3. **Check Firestore:**
   - `system-checks/` — should have check result docs
   - `system-heartbeats/firebase-functions` — should appear after first high-tier run

4. **Check Cloud Scheduler:**
   - Go to Cloud Scheduler in GCP Console
   - Verify all 3 jobs show "Success" after first trigger

---

## Environment Variables Summary

| Variable | Required? | Description |
|---|---|---|
| `GCP_PROJECT` | Yes | `dataloggerdev` |
| `GREEN_API_SEND_MESSAGE_URL` | No | Green API endpoint. If missing → no WhatsApp, still writes to Firestore |
| `GREEN_API_CHAT_ID` | No | WhatsApp group ID. If missing → no WhatsApp |

---

## Behavior Without WhatsApp

If `GREEN_API_SEND_MESSAGE_URL` is not set:
- All checks still run ✅
- Results still written to `system-checks/` ✅
- Incidents still created/resolved in `system-incidents/` ✅
- Firebase Functions stats still written ✅
- Daily rotation still runs ✅
- WhatsApp alerts → skipped with log warning ⚠️
- Admin UI still shows all data from Firestore ✅

You can add WhatsApp anytime later by updating the env vars.

---

## Estimated Time

~15 minutes total (service account + deploy + scheduler jobs + verify).
