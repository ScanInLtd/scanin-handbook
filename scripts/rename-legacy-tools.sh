#!/bin/bash

# Script to rename legacy tool repositories to standardized naming convention
# FirestoreDataRequestService and SensorCloneDiluteApp

set -e  # Exit on error

echo "🏷️  Starting legacy tools rename process..."
echo ""

# Organization
ORG="ScanInLtd"

# Array of repos: old_name|new_name|description
declare -a repos=(
    "FirestoreDataRequestService|scanin-tool-firestore-data-export|Tool for exporting sensor data from Firestore to Excel and emailing results"
    "SensorCloneDiluteApp|scanin-tool-sensor-clone|Windows application for cloning, diluting, and manipulating sensor data"
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
echo "✨ Legacy tools rename complete!"
echo ""
echo "💡 Next steps:"
echo "   1. Verify renames at: https://github.com/orgs/$ORG/repositories"
echo "   2. Update inventory.md with standardized names"
