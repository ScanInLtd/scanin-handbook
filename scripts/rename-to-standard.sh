#!/bin/bash

# Script to rename ScanIn repositories to standardized naming convention
# Based on renaming.md

set -e  # Exit on error

echo "🏷️  Starting repository standardization rename process..."
echo ""

# Organization
ORG="ScanInLtd"

# Array of repos: old_name|new_name|description
declare -a repos=(
    "ScaninEspDatalogger|scanin-fw-datalogger|ESP datalogger firmware + Flutter BLE companion app (monorepo)"
    "scanin-platform|scanin-web-platform|Main Angular web platform for users and field workers"
    "monitoring-bridge|scanin-svc-mqtt-bridge|Core MQTT↔Firestore bridge: ingest telemetry and push configs to devices"
    "ScanInMonitorFirebaseFunctions|scanin-svc-firebase-functions|Firebase Functions for alerts, scheduling, reports, and maintenance tasks"
    "scanin-reports-service|scanin-svc-reports|Long-running service that generates and distributes reports across sensor types"
    "daily-prism-processing|scanin-worker-prism-daily|Daily batch job for prism sensor processing (averaging, smoothing, charts prep)"
    "FirestoreAdjustmentWorker|scanin-worker-firestore-adjustments|On-demand worker for Firestore data manipulation and corrections"
    "HexagonAtsReportHandler|scanin-svc-hexagon-ats-ingestion|Long-running service that ingests Hexagon/Leica ATS reports from email and writes to Firestore"
    "ScaninVibrationService|scanin-svc-beanair-vibration-processor|Service processing Beanair/Wilow vibration outputs and publishing results via MQTT"
    "datalogger-esp-flasher|scanin-tool-esp-flasher|Windows lab tool to flash ESP firmware onto dataloggers"
)

# Counter for tracking
total=${#repos[@]}
success=0
failed=0

echo "📋 Found $total repositories to rename"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Loop through each repo and rename with description
for repo_line in "${repos[@]}"; do
    IFS='|' read -r old_name new_name description <<< "$repo_line"
    
    echo "🏷️  Renaming: $old_name"
    echo "   From: $ORG/$old_name"
    echo "   To:   $ORG/$new_name"
    echo "   Desc: $description"
    
    if gh api \
        -X PATCH \
        -H "Accept: application/vnd.github+json" \
        "/repos/$ORG/$old_name" \
        -f name="$new_name" \
        -f description="$description" 2>/dev/null; then
        
        echo "   ✅ Success!"
        ((success++))
    else
        echo "   ❌ Failed (may not exist or already renamed)"
        ((failed++))
    fi
    
    echo ""
    sleep 1  # Small delay to avoid rate limiting
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 Rename Summary:"
echo "   Total:   $total"
echo "   Success: $success"
echo "   Failed:  $failed"
echo ""
echo "✨ Standardization complete!"
echo ""
echo "💡 Next steps:"
echo "   1. Verify renames at: https://github.com/orgs/$ORG/repositories"
echo "   2. Update inventory.md with standardized names"
echo "   3. Update local git remotes if needed"
