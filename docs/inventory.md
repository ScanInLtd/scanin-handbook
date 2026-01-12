# ScanIn Platform – Repository Inventory

Complete list of all ScanIn repositories and their purpose.

---

## Firmware / Devices

| Repository | Description |
|----|----|
| **[scanin-fw-datalogger](https://github.com/ScanInLtd/scanin-fw-datalogger)** | ESP datalogger firmware + Flutter BLE companion app (monorepo) |

---

## Web

| Repository | Description |
|----|----|
| **[scanin-web-platform](https://github.com/ScanInLtd/scanin-web-platform)** | Main Angular web platform for users and field workers |

---

## Services

| Repository | Description |
|----|----|
| **[scanin-svc-mqtt-bridge](https://github.com/ScanInLtd/scanin-svc-mqtt-bridge)** | Core MQTT↔Firestore bridge: ingest telemetry and push configs to devices |
| **[scanin-svc-firebase-functions](https://github.com/ScanInLtd/scanin-svc-firebase-functions)** | Firebase Functions for alerts, scheduling, reports, and maintenance tasks |
| **[scanin-svc-reports](https://github.com/ScanInLtd/scanin-svc-reports)** | Long-running service that generates and distributes reports across sensor types |
| **[scanin-svc-hexagon-ats-ingestion](https://github.com/ScanInLtd/scanin-svc-hexagon-ats-ingestion)** | Long-running service that ingests Hexagon/Leica ATS reports from email and writes to Firestore |
| **[scanin-svc-beanair-vibration-processor](https://github.com/ScanInLtd/scanin-svc-beanair-vibration-processor)** | Service processing Beanair/Wilow vibration outputs and publishing results via MQTT |

---

## Workers

| Repository | Description |
|----|----|
| **[scanin-worker-prism-daily](https://github.com/ScanInLtd/scanin-worker-prism-daily)** | Daily batch job for prism sensor processing (averaging, smoothing, charts prep) |
| **[scanin-worker-firestore-adjustments](https://github.com/ScanInLtd/scanin-worker-firestore-adjustments)** | On-demand worker for Firestore data manipulation and corrections |

---

## Tools

| Repository | Description |
|----|----|
| **[scanin-tool-esp-flasher](https://github.com/ScanInLtd/scanin-tool-esp-flasher)** | Windows lab tool to flash ESP firmware onto dataloggers |
| **[scanin-tool-firestore-data-export](https://github.com/ScanInLtd/scanin-tool-firestore-data-export)** | Tool for exporting sensor data from Firestore to Excel and emailing results |
| **[scanin-tool-sensor-clone](https://github.com/ScanInLtd/scanin-tool-sensor-clone)** | Windows application for cloning, diluting, and manipulating sensor data |

