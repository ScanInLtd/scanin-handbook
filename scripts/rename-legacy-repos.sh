#!/bin/bash

# Script to rename legacy ScanInLtd repositories with "archive-" prefix
# Based on inventory.md - Legacy Repos (To Review) section

set -e  # Exit on error

echo "🏷️  Starting repository rename process..."
echo ""

# Array of repos to rename with archive- prefix
declare -a repos=(
    "HotBalloon"
    "SamdRfBalloons"
    "ScaninMonitorSupervisor"
    "TargetsBridgeService"
    "TargetsHubPhoton"
    "ats-email-handler"
    "bloon_client"
    "bloon_target"
    "saola-all"
    "scanin-monitor"
    "scanin-monitor-ui"
    "targets_client"
)

# Organization
ORG="ScanInLtd"

# Counter for tracking
total=${#repos[@]}
success=0
failed=0

echo "📋 Found $total repositories to rename"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Loop through each repo and rename
for repo in "${repos[@]}"; do
    new_name="archive-${repo}"
    
    echo "🏷️  Renaming: $repo"
    echo "   From: $ORG/$repo"
    echo "   To:   $ORG/$new_name"
    
    if gh api \
        -X PATCH \
        -H "Accept: application/vnd.github+json" \
        "/repos/$ORG/$repo" \
        -f name="$new_name" 2>/dev/null; then
        
        echo "   ✅ Success!"
        ((success++))
    else
        echo "   ❌ Failed"
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
echo "✨ Rename process complete!"
echo ""
echo "💡 Next steps:"
echo "   1. Verify renames at: https://github.com/orgs/$ORG/repositories"
echo "   2. Update inventory.md with new names"
echo "   3. Archive the repos if desired using: gh repo archive <repo>"
