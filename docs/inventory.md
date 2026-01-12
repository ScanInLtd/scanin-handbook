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
| ScaninEspDatalogger | https://github.com/ScanInLtd/ScaninEspDatalogger | ESP datalogger firmware + Flutter BLE app (monorepo) | scanin-fw-datalogger | 🔄 | Keep monorepo for now |

---

## Web

| Repo | Current URL | Description | Target Repo Name | Status | Notes |
|----|----|----|----|----|----|
| scanin-platform | https://github.com/ScanInLtd/scanin-platform | Main Angular web platform | scanin-web-platform | ⬜ | Already in org |

---

## Cloud Services (Core)

| Repo | Current URL | Description | Target Repo Name | Status | Notes |
|----|----|----|----|----|----|
| monitoring-bridge | https://github.com/ScanInLtd/monitoring-bridge | MQTT ↔ Firestore bridge (core ingestion service) | scanin-svc-mqtt-bridge | 🔄 | Runs on GCP VM |
| ScanInMonitorFirebaseFunctions | https://github.com/ScanInLtd/ScanInMonitorFirebaseFunctions | Firebase scheduled & DB-triggered functions | scanin-svc-firebase-functions | 🔄 | |
| scanin-reports-service | https://github.com/ScanInLtd/scanin-reports-service | Report generation & distribution service | scanin-svc-reports | 🔄 | |

---

## Workers / Batch Processing

| Repo | Current URL | Description | Target Repo Name | Status | Notes |
|----|----|----|----|----|----|
| daily-prism-processing | https://github.com/ScanInLtd/daily-prism-processing | Daily processing for prism sensors | scanin-worker-prism-daily | 🔄 | Cloud Run |
| FirestoreAdjustmentWorker | https://github.com/ScanInLtd/FirestoreAdjustmentWorker | Firestore data manipulation worker | scanin-worker-firestore-adjustments | 🔄 | |

---

## Local / Windows Services

| Repo | Current URL | Description | Target Repo Name | Status | Notes |
|----|----|----|----|----|----|
| HexagonAtsReportHandler | https://github.com/ScanInLtd/HexagonAtsReportHandler | ATS email ingestion & Firestore import | scanin-svc-hexagon-ats-ingestion | ⬜ | Runs on local PC |
| ScaninVibrationService | https://github.com/ScanInLtd/ScaninVibrationService | Processes Beanair vibration outputs | scanin-svc-vibration-processor | 🔄 | Local Windows |

---

## Tools / Utilities

| Repo | Current URL | Description | Target Repo Name | Status | Notes |
|----|----|----|----|----|----|
| datalogger-esp-flasher | https://github.com/ScanInLtd/datalogger-esp-flasher | Windows tool for flashing ESP dataloggers | scanin-tool-esp-flasher | 🔄 | |

---

## Legacy (Archive)

| Repo | Current URL | Description | Target Repo Name | Status | Notes |
|----|----|----|----|----|----|
| FirestoreDataRequestService | https://github.com/ScanInLtd/FirestoreDataRequestService | Legacy Excel export service | scanin-legacy-firestore-data-export | 🔄 | Archive |
| SensorCloneDiluteApp | https://github.com/ScanInLtd/SensorCloneDiluteApp | Legacy Windows sensor manipulation tool | scanin-legacy-sensor-clone-tool | 🔄 | Archive |

---

## Legacy Repos (To Review)

| Repo | Current URL | Description | Target Repo Name | Status | Notes |
|----|----|----|----|----|----|
| archive-HotBalloon | https://github.com/ScanInLtd/archive-HotBalloon | | | ✏️ | Renamed with archive- prefix |
| archive-SamdRfBalloons | https://github.com/ScanInLtd/archive-SamdRfBalloons | | | ✏️ | Renamed with archive- prefix |
| archive-ScaninMonitorSupervisor | https://github.com/ScanInLtd/archive-ScaninMonitorSupervisor | Check threshold and connectivity, create alerts | | ✏️ | Renamed with archive- prefix |
| archive-TargetsBridgeService | https://github.com/ScanInLtd/archive-TargetsBridgeService | | | ✏️ | Renamed with archive- prefix |
| archive-TargetsHubPhoton | https://github.com/ScanInLtd/archive-TargetsHubPhoton | | | ✏️ | Renamed with archive- prefix |
| archive-ats-email-handler | https://github.com/ScanInLtd/archive-ats-email-handler | Nodejs project for Hexagon emails scrapping | | ✏️ | Renamed with archive- prefix (duplicate of HexagonAtsReportHandler) |
| archive-bloon_client | https://github.com/ScanInLtd/archive-bloon_client | | | ✏️ | Renamed with archive- prefix |
| archive-bloon_target | https://github.com/ScanInLtd/archive-bloon_target | | | ✏️ | Renamed with archive- prefix |
| archive-saola-all | https://github.com/ScanInLtd/archive-saola-all | | | ✏️ | Renamed with archive- prefix |
| archive-scanin-monitor | https://github.com/ScanInLtd/archive-scanin-monitor | | | ✏️ | Renamed with archive- prefix |
| archive-scanin-monitor-ui | https://github.com/ScanInLtd/archive-scanin-monitor-ui | New version of scanin monitoring web ui (started May 2024) | | ✏️ | Renamed with archive- prefix |
| archive-targets_client | https://github.com/ScanInLtd/archive-targets_client | | | ✏️ | Renamed with archive- prefix |

---

## Notes / Decisions Log
- ESP firmware + Flutter BLE app stays monorepo for now
- Legacy repos will be archived, not deleted
- **2026-01-12**: All repositories successfully transferred to ScanInLtd organization
- **2026-01-12**: 12 legacy repos renamed with 'archive-' prefix for clarity
