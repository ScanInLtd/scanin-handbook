#!/bin/bash

# Script to update git remotes for local ScanIn repositories
# Updates both organization (hillelvidal -> ScanInLtd) and renamed repos

set -e  # Exit on error

echo "🔄 Starting git remote update process..."
echo ""

# Base directory
BASE_DIR="/Users/hillelvidal/dev/clients/scanin"

# Array of repos: local_folder|new_remote_url
declare -a repos=(
    "ScanInMonitorFirebaseFunctions|git@github.com:ScanInLtd/scanin-svc-firebase-functions.git"
    "ScaninEspDatalogger|git@github.com:ScanInLtd/scanin-fw-datalogger.git"
    "daily-prism-processing|git@github.com:ScanInLtd/scanin-worker-prism-daily.git"
    "datalogger-esp-flasher|git@github.com:ScanInLtd/scanin-tool-esp-flasher.git"
    "monitoring-bridge|git@github.com:ScanInLtd/scanin-svc-mqtt-bridge.git"
    "scanin-reports-service|git@github.com:ScanInLtd/scanin-svc-reports.git"
    "scanin-platform|git@github.com:ScanInLtd/scanin-web-platform.git"
)

# Counter for tracking
total=${#repos[@]}
success=0
failed=0

echo "📋 Found $total local repositories to update"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Loop through each repo and update remote
for repo_line in "${repos[@]}"; do
    IFS='|' read -r folder new_url <<< "$repo_line"
    
    repo_path="$BASE_DIR/$folder"
    
    echo "🔄 Updating: $folder"
    echo "   Path: $repo_path"
    
    if [ ! -d "$repo_path" ]; then
        echo "   ⚠️  Directory not found, skipping"
        ((failed++))
        echo ""
        continue
    fi
    
    # Get current remote
    current_url=$(git -C "$repo_path" remote get-url origin 2>/dev/null || echo "none")
    echo "   Old:  $current_url"
    echo "   New:  $new_url"
    
    # Update remote
    if git -C "$repo_path" remote set-url origin "$new_url" 2>/dev/null; then
        # Verify the change
        updated_url=$(git -C "$repo_path" remote get-url origin)
        echo "   ✅ Success! Verified: $updated_url"
        ((success++))
    else
        echo "   ❌ Failed to update remote"
        ((failed++))
    fi
    
    echo ""
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 Update Summary:"
echo "   Total:   $total"
echo "   Success: $success"
echo "   Failed:  $failed"
echo ""
echo "✨ Remote update complete!"
echo ""
echo "💡 Next steps:"
echo "   1. Test with: git fetch origin"
echo "   2. Consider renaming local folders to match new repo names"
echo "   3. Update any scripts/configs that reference old paths"
