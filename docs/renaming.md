ScaninEspDatalogger
→ scanin-fw-datalogger
→ ESP datalogger firmware + Flutter BLE companion app (monorepo)

scanin-platform
→ scanin-web-platform
→ Main Angular web platform for users and field workers

monitoring-bridge
→ scanin-svc-mqtt-bridge
→ Core MQTT↔Firestore bridge: ingest telemetry and push configs to devices

ScanInMonitorFirebaseFunctions
→ scanin-svc-firebase-functions
→ Firebase Functions for alerts, scheduling, reports, and maintenance tasks

scanin-reports-service
→ scanin-svc-reports
→ Long-running service that generates and distributes reports across sensor types

daily-prism-processing
→ scanin-worker-prism-daily
→ Daily batch job for prism sensor processing (averaging, smoothing, charts prep)

FirestoreAdjustmentWorker
→ scanin-worker-firestore-adjustments
→ On-demand worker for Firestore data manipulation and corrections

HexagonAtsReportHandler
→ scanin-svc-hexagon-ats-ingestion
→ Long-running service that ingests Hexagon/Leica ATS reports from email and writes to Firestore

ScaninVibrationService
→ scanin-svc-beanair-vibration-processor
→ Service processing Beanair/Wilow vibration outputs and publishing results via MQTT

datalogger-esp-flasher
→ scanin-tool-esp-flasher
→ Windows lab tool to flash ESP firmware onto dataloggers
