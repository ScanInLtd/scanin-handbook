# 🏗 ScanIn Platform

> **Industrial building monitoring platform**  
> Integrating on-site devices, cloud services, and analytics to deliver real-time monitoring, alerts, and reporting across multiple sensor technologies.

---

## Table of Contents

- [Overview](#overview)
- [System at a Glance](#system-at-a-glance)
- [Core Domains](#core-domains)
- [Data Flow](#data-flow)
- [Runtime & Environments](#runtime--environments)
- [Repository Map](#repository-map)
- [Technology Stack](#technology-stack)
- [Operational Model](#operational-model)
- [Status & Maturity](#status--maturity)
- [Documentation & Scripts](#documentation--scripts)

---

## Overview

**Purpose**

ScanIn monitors structural integrity and environmental conditions across construction sites and industrial facilities. The platform serves field workers, site managers, and engineering teams by providing real-time visibility into sensor data, automated alerting for threshold violations, and comprehensive reporting for compliance and analysis.

**Key Characteristics**

* **Multi-sensor support**: ESP-based dataloggers, Beanair vibration sensors, Hexagon/Leica ATS precision instruments, prism monitoring, and custom IoT devices
* **Event-driven architecture**: Real-time ingestion via MQTT with asynchronous processing pipelines
* **Batch processing**: Scheduled jobs for aggregation, smoothing, and chart preparation
* **Hybrid runtime**: Cloud services for core platform, local services for vendor integrations and lab operations

**Scope**

This document provides a high-level technical overview; detailed implementation and operational procedures are documented in individual repositories.

---

## System at a Glance

ScanIn consists of:

- **Field Devices & Sensors** – ESP dataloggers, vendor instruments, and custom hardware deployed on-site
- **Ingestion & Messaging Layer** – MQTT-based telemetry collection and device configuration distribution
- **Processing & Analytics** – Real-time validation, sensor-specific pipelines, and scheduled batch jobs
- **Web & Mobile Interfaces** – Angular web platform for users and field workers, Flutter mobile apps for provisioning
- **Reporting & Alerts** – Automated report generation, threshold monitoring, and alert distribution
- **Operational & Lab Tools** – Device flashing, data correction utilities, and local ingestion services

---

## Core Domains

### 🧱 Field Devices & Firmware

Custom ESP32-based dataloggers with BLE provisioning for on-site deployment. Firmware handles sensor reading, local buffering, and MQTT transmission. Flutter companion app enables field workers to configure devices without cloud connectivity.

### ☁️ Cloud & Messaging

MQTT serves as the primary ingestion protocol, bridging field devices to cloud infrastructure. Firestore acts as the central datastore for telemetry, device metadata, and user data. Event-driven architecture enables real-time processing and alerting.

### 📊 Analytics & Processing

Sensor-specific processing pipelines handle validation, calibration, and enrichment. Real-time workers process incoming telemetry for immediate alerts. Scheduled batch jobs perform daily aggregation, smoothing, and chart preparation for prism sensors and other long-term monitoring applications.

### 🌐 Interfaces

Angular-based web platform provides dashboards, sensor management, alert configuration, and historical analysis. Mobile workflows support field installation and device commissioning. Role-based access controls separate operator, installer, and administrator views.

### 🛠 Operations & Tooling

Lab tools enable firmware flashing and device provisioning. Data correction workers handle manual adjustments and bulk operations. Local Windows services integrate with vendor-specific protocols (Hexagon ATS email ingestion, Beanair vibration processing).

---

## Data Flow

The canonical data path through ScanIn:

1. **Sensor generates measurements** – Field devices collect readings (displacement, vibration, temperature, etc.)
2. **MQTT transmission** – Devices publish telemetry to cloud MQTT broker with device ID and timestamp
3. **Ingestion service validates & stores** – MQTT bridge validates payloads, enriches with metadata, writes to Firestore
4. **Processing services enrich data** – Real-time workers apply calibration, check thresholds, trigger alerts
5. **Batch jobs aggregate** – Scheduled workers compute daily averages, smooth trends, prepare visualization data
6. **Alerts & reports generated** – Firebase Functions send notifications, generate PDF reports, distribute via email
7. **Web platform presents results** – Users view dashboards, configure alerts, download reports, analyze trends

---

## Runtime & Environments

ScanIn runs across multiple environments:

### Cloud (GCP)

- **Firebase** – Firestore (primary datastore), Cloud Functions (alerts, scheduling, maintenance), Hosting (web platform)
- **Cloud Run** – Containerized batch workers (prism processing, data adjustments)
- **Compute Engine VMs** – Long-running services (MQTT bridge, report generation)

### Local / On-Premises

- **Windows services** – Vendor integrations requiring local network access (Hexagon ATS email scraping, Beanair vibration processing)
- **Lab tools** – Device provisioning and firmware flashing utilities for operations team

---

## Repository Map

### Firmware

- **[scanin-fw-datalogger](https://github.com/ScanInLtd/scanin-fw-datalogger)**  
  ESP datalogger firmware and Flutter BLE companion app (monorepo).

### Web

- **[scanin-web-platform](https://github.com/ScanInLtd/scanin-web-platform)**  
  Main Angular web platform for users and field workers.

### Services

- **[scanin-svc-mqtt-bridge](https://github.com/ScanInLtd/scanin-svc-mqtt-bridge)**  
  Core MQTT↔Firestore bridge: ingest telemetry and push configs to devices.

- **[scanin-svc-firebase-functions](https://github.com/ScanInLtd/scanin-svc-firebase-functions)**  
  Firebase Functions for alerts, scheduling, reports, and maintenance tasks.

- **[scanin-svc-reports](https://github.com/ScanInLtd/scanin-svc-reports)**  
  Long-running service that generates and distributes reports across sensor types.

- **[scanin-svc-hexagon-ats-ingestion](https://github.com/ScanInLtd/scanin-svc-hexagon-ats-ingestion)**  
  Long-running service that ingests Hexagon/Leica ATS reports from email and writes to Firestore.

- **[scanin-svc-beanair-vibration-processor](https://github.com/ScanInLtd/scanin-svc-beanair-vibration-processor)**  
  Service processing Beanair/Wilow vibration outputs and publishing results via MQTT.

### Workers

- **[scanin-worker-prism-daily](https://github.com/ScanInLtd/scanin-worker-prism-daily)**  
  Daily batch job for prism sensor processing (averaging, smoothing, charts prep).

- **[scanin-worker-firestore-adjustments](https://github.com/ScanInLtd/scanin-worker-firestore-adjustments)**  
  On-demand worker for Firestore data manipulation and corrections.

### Tools

- **[scanin-tool-esp-flasher](https://github.com/ScanInLtd/scanin-tool-esp-flasher)**  
  Windows lab tool to flash ESP firmware onto dataloggers.

- **[scanin-tool-firestore-data-export](https://github.com/ScanInLtd/scanin-tool-firestore-data-export)**  
  Tool for exporting sensor data from Firestore to Excel and emailing results.

- **[scanin-tool-sensor-clone](https://github.com/ScanInLtd/scanin-tool-sensor-clone)**  
  Windows application for cloning, diluting, and manipulating sensor data.

---

## Technology Stack

**Languages**
- TypeScript, JavaScript (Node.js)
- C/C++ (ESP32 firmware)
- Dart (Flutter mobile apps)
- C# (.NET Windows services)

**Frameworks & Libraries**
- Angular (web platform)
- Flutter (mobile provisioning)
- Express.js (services)
- PlatformIO (firmware)

**Cloud & Infrastructure**
- Firebase (Firestore, Functions, Hosting, Auth)
- Google Cloud Platform (Cloud Run, Compute Engine)
- MQTT (Eclipse Mosquitto)

**Data & Storage**
- Firestore (primary datastore)
- Cloud Storage (reports, exports)

**Operating Systems**
- Linux (cloud services)
- Windows (local integrations, lab tools)

---

## Operational Model

ScanIn operates through a combination of event-driven services and scheduled batch processing:

- **Event-driven services** respond to MQTT messages, Firestore triggers, and HTTP requests in real-time
- **Scheduled jobs** run daily or on-demand for aggregation, reporting, and maintenance tasks
- **Manual tools** enable operators to flash devices, correct data, and generate ad-hoc exports
- **Separation of concerns** between production runtime (cloud) and lab tooling (local Windows)

The platform is designed for continuous operation with minimal manual intervention. Alerts notify operators of threshold violations, device offline events, and processing failures.

---

## Status & Maturity

The platform is production-grade and actively used across multiple construction sites and industrial facilities.

Core services (ingestion, web platform, alerting) are stable and long-running. Sensor-specific processing pipelines evolve as new sensor types are integrated. Lab tooling and data correction utilities support operational workflows.

---

## Documentation & Scripts

### 📚 Documentation (`docs/`)
- **[Repository Inventory](docs/inventory.md)** – Complete list of all ScanIn repositories, their purpose, and migration status
- **[Renaming Guide](docs/renaming.md)** – Standardized naming conventions and repo renames

### 🛠️ Scripts (`scripts/`)
- `transfer-repos.sh` – Transfer repositories from hillelvidal to ScanInLtd organization
- `rename-legacy-repos.sh` – Rename legacy repos with "archive-" prefix
- `rename-legacy-tools.sh` – Rename legacy tool repos to standardized names
- `rename-to-standard.sh` – Rename all repos to standardized naming convention
- `update-local-remotes.sh` – Update local git remotes after repo transfers/renames

---

## Migration Summary (2026-01-12)

✅ **Completed:**
- Transferred 10 repositories from hillelvidal to ScanInLtd
- Renamed 12 legacy repos with "archive-" prefix
- Standardized naming for all active repos (scanin-fw-*, scanin-svc-*, scanin-worker-*, scanin-tool-*)
- Updated all repository descriptions

---

_Last updated: 2026-01-12_
