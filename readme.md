# ScanIn Handbook

This repository contains internal documentation for the ScanIn platform.

## Contents

### 📚 Documentation (`docs/`)
- **[Repository Inventory](docs/inventory.md)** - Complete list of all ScanIn repositories, their purpose, and migration status
- **[Renaming Guide](docs/renaming.md)** - Standardized naming conventions and repo renames

### 🛠️ Scripts (`scripts/`)
- `transfer-repos.sh` - Transfer repositories from hillelvidal to ScanInLtd organization
- `rename-legacy-repos.sh` - Rename legacy repos with "archive-" prefix
- `rename-legacy-tools.sh` - Rename legacy tool repos to standardized names
- `rename-to-standard.sh` - Rename all repos to standardized naming convention
- `update-local-remotes.sh` - Update local git remotes after repo transfers/renames

## Quick Start

➡️ **Start here:** [Repository Inventory](docs/inventory.md)

## Migration Summary (2026-01-12)

✅ **Completed:**
- Transferred 10 repositories from hillelvidal to ScanInLtd
- Renamed 12 legacy repos with "archive-" prefix
- Standardized naming for all active repos (scanin-fw-*, scanin-svc-*, scanin-worker-*, scanin-tool-*)
- Updated all repository descriptions
