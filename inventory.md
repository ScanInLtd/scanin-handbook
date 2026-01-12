# ScanIn Platform – Repository Inventory

This document tracks **all existing repositories**, their purpose,
current location, and migration status into the ScanInLtd organization.

> ⚠️ This is a working document used during migration.
> Repositories should not be transferred / renamed unless marked explicitly.

---

## Legend
- **Status**:
  - ⬜ Pending
  - 🔄 Transferred
  - ✏️ Renamed
  - 📦 Archived
  - ✅ Done

---

## Firmware / Devices

| Repo | Current URL | Description | Target Repo Name | Status | Notes |
|----|----|----|----|----|----|
| ScaninEspDatalogger | https://github.com/hillelvidal/ScaninEspDatalogger | ESP datalogger firmware + Flutter BLE app (monorepo) | scanin-fw-datalogger | ⬜ | Keep monorepo for now |

---

## Web

| Repo | Current URL | Description | Target Repo Name | Status | Notes |
|----|----|----|----|----|----|
| scanin-platform | https://github.com/ScanInLtd/scanin-platform | Main Angular web platform | scanin-web-platform | ⬜ | Already in org |

---

## Cloud Services (Core)

| Repo | Current URL | Description | Target Repo Name | Status | Notes |
|----|----|----|----|----|----|
| monitoring-bridge | https://github.com/hillelvidal/monitoring-bridge | MQTT ↔ Firestore bridge (core ingestion service) | scanin-svc-mqtt-bridge | ⬜ | Runs on GCP VM |
| ScanInMonitorFirebaseFunctions | https://github.com/hillelvidal/ScanInMonitorFirebaseFunctions | Firebase scheduled & DB-triggered functions | scanin-svc-firebase-functions | ⬜ | |
| scanin-reports-service | https://github.com/hillelvidal/scanin-reports-service | Report generation & distribution service | scanin-svc-reports | ⬜ | |

---

## Workers / Batch Processing

| Repo | Current URL | Description | Target Repo Name | Status | Notes |
|----|----|----|----|----|----|
| daily-prism-processing | https://github.com/hillelvidal/daily-prism-processing | Daily processing for prism sensors | scanin-worker-prism-daily | ⬜ | Cloud Run |
| FirestoreAdjustmentWorker | https://github.com/hillelvidal/FirestoreAdjustmentWorker | Firestore data manipulation worker | scanin-worker-firestore-adjustments | ⬜ | |

---

## Local / Windows Services

| Repo | Current URL | Description | Target Repo Name | Status | Notes |
|----|----|----|----|----|----|
| HexagonAtsReportHandler | https://github.com/ScanInLtd/HexagonAtsReportHandler | ATS email ingestion & Firestore import | scanin-svc-hexagon-ats-ingestion | ⬜ | Runs on local PC |
| ScaninVibrationService | https://github.com/hillelvidal/ScaninVibrationService | Processes Beanair vibration outputs | scanin-svc-vibration-processor | ⬜ | Local Windows |

---

## Tools / Utilities

| Repo | Current URL | Description | Target Repo Name | Status | Notes |
|----|----|----|----|----|----|
| datalogger-esp-flasher | https://github.com/hillelvidal/datalogger-esp-flasher | Windows tool for flashing ESP dataloggers | scanin-tool-esp-flasher | ⬜ | |

---

## Legacy (Archive)

| Repo | Current URL | Description | Target Repo Name | Status | Notes |
|----|----|----|----|----|----|
| FirestoreDataRequestService | https://github.com/hillelvidal/FirestoreDataRequestService | Legacy Excel export service | scanin-legacy-firestore-data-export | ⬜ | Archive |
| SensorCloneDiluteApp | https://github.com/hillelvidal/SensorCloneDiluteApp | Legacy Windows sensor manipulation tool | scanin-legacy-sensor-clone-tool | ⬜ | Archive |

---

## Notes / Decisions Log
- ESP firmware + Flutter BLE app stays monorepo for now
- Legacy repos will be archived, not deleted
