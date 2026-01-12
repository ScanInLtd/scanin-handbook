#!/bin/bash

# Script to transfer ScanIn repositories from hillelvidal to ScanInLtd organization
# Based on inventory.md

set -e  # Exit on error

echo "🚀 Starting repository transfer process..."
echo ""

# Array of repos to transfer (excluding those already in ScanInLtd)
# Note: ScaninEspDatalogger already transferred
declare -a repos=(
    "monitoring-bridge"
    "ScanInMonitorFirebaseFunctions"
    "scanin-reports-service"
    "daily-prism-processing"
    "FirestoreAdjustmentWorker"
    "ScaninVibrationService"
    "datalogger-esp-flasher"
    "FirestoreDataRequestService"
    "SensorCloneDiluteApp"
)

# Target organization
NEW_OWNER="ScanInLtd"
OLD_OWNER="hillelvidal"

# Counter for tracking
total=${#repos[@]}
success=0
failed=0

echo "📋 Found $total repositories to transfer"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Loop through each repo and transfer
for repo in "${repos[@]}"; do
    echo "📦 Transferring: $repo"
    echo "   From: $OLD_OWNER/$repo"
    echo "   To:   $NEW_OWNER/$repo"
    
    if gh api \
        -X POST \
        -H "Accept: application/vnd.github+json" \
        "/repos/$OLD_OWNER/$repo/transfer" \
        -f new_owner="$NEW_OWNER" 2>/dev/null; then
        
        echo "   ✅ Success!"
        ((success++))
    else
        echo "   ❌ Failed (may not exist or already transferred)"
        ((failed++))
    fi
    
    echo ""
    sleep 1  # Small delay to avoid rate limiting
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 Transfer Summary:"
echo "   Total:   $total"
echo "   Success: $success"
echo "   Failed:  $failed"
echo ""
echo "✨ Transfer process complete!"
echo ""
echo "💡 Next steps:"
echo "   1. Verify transfers at: https://github.com/orgs/$NEW_OWNER/repositories"
echo "   2. Update inventory.md status column"
echo "   3. Update local git remotes if needed"
