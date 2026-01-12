#!/bin/bash

# Script to scrape ScanIn repository data and generate Repository Map summaries
# Extracts: description, README, package files, and runtime signals

set -e

echo "📚 Generating Repository Map data..."
echo ""

ORG="ScanInLtd"
OUTPUT_DIR="./repo-data"
SUMMARY_FILE="./repo-summaries.md"

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Active repos to scrape (excluding archive-* repos)
declare -a repos=(
    "scanin-fw-datalogger"
    "scanin-web-platform"
    "scanin-svc-mqtt-bridge"
    "scanin-svc-firebase-functions"
    "scanin-svc-reports"
    "scanin-svc-hexagon-ats-ingestion"
    "scanin-svc-beanair-vibration-processor"
    "scanin-worker-prism-daily"
    "scanin-worker-firestore-adjustments"
    "scanin-tool-esp-flasher"
    "scanin-tool-firestore-data-export"
    "scanin-tool-sensor-clone"
)

echo "🔍 Scraping ${#repos[@]} repositories..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Clear previous summaries
> "$SUMMARY_FILE"

for repo in "${repos[@]}"; do
    echo "📦 Processing: $repo"
    
    repo_dir="$OUTPUT_DIR/$repo"
    mkdir -p "$repo_dir"
    
    # Fetch repo metadata
    echo "  → Fetching metadata..."
    gh api "/repos/$ORG/$repo" > "$repo_dir/metadata.json" 2>/dev/null || echo "{}" > "$repo_dir/metadata.json"
    
    # Extract description
    description=$(jq -r '.description // "No description"' "$repo_dir/metadata.json")
    
    # Fetch README (first 500 lines)
    echo "  → Fetching README..."
    gh api "/repos/$ORG/$repo/readme" --jq '.content' 2>/dev/null | base64 -d 2>/dev/null | head -n 500 > "$repo_dir/README.md" || echo "" > "$repo_dir/README.md"
    
    # Fetch package.json if exists
    echo "  → Checking for package.json..."
    gh api "/repos/$ORG/$repo/contents/package.json" --jq '.content' 2>/dev/null | base64 -d 2>/dev/null > "$repo_dir/package.json" || echo "{}" > "$repo_dir/package.json"
    
    # Fetch platformio.ini if exists (for firmware)
    echo "  → Checking for platformio.ini..."
    gh api "/repos/$ORG/$repo/contents/platformio.ini" 2>/dev/null | jq -r '.content' | base64 -d 2>/dev/null > "$repo_dir/platformio.ini" || echo "" > "$repo_dir/platformio.ini"
    
    # Fetch pubspec.yaml if exists (for Flutter)
    echo "  → Checking for pubspec.yaml..."
    gh api "/repos/$ORG/$repo/contents/pubspec.yaml" 2>/dev/null | jq -r '.content' | base64 -d 2>/dev/null > "$repo_dir/pubspec.yaml" || echo "" > "$repo_dir/pubspec.yaml"
    
    # Fetch .csproj files if exists (for C#)
    echo "  → Checking for .csproj..."
    gh api "/repos/$ORG/$repo/contents" 2>/dev/null | jq -r '.[] | select(.name | endswith(".csproj")) | .name' | head -n 1 > "$repo_dir/csproj_name.txt" || echo "" > "$repo_dir/csproj_name.txt"
    
    # Get primary language
    language=$(jq -r '.language // "Unknown"' "$repo_dir/metadata.json")
    
    # Get topics
    topics=$(jq -r '.topics | join(", ")' "$repo_dir/metadata.json")
    
    # Write summary data
    cat >> "$SUMMARY_FILE" << EOF

---
## $repo

**Description:** $description
**Language:** $language
**Topics:** $topics

**README Preview:**
\`\`\`
$(head -n 30 "$repo_dir/README.md")
\`\`\`

**Package Info:**
$(if [ -s "$repo_dir/package.json" ]; then
    echo "- package.json found"
    jq -r 'if .name then "  - Name: \(.name)" else "" end' "$repo_dir/package.json"
    jq -r 'if .description then "  - Description: \(.description)" else "" end' "$repo_dir/package.json"
fi)
$(if [ -s "$repo_dir/platformio.ini" ]; then
    echo "- platformio.ini found (ESP32 firmware)"
fi)
$(if [ -s "$repo_dir/pubspec.yaml" ]; then
    echo "- pubspec.yaml found (Flutter app)"
fi)
$(if [ -s "$repo_dir/csproj_name.txt" ]; then
    echo "- .csproj found (C# project)"
fi)

EOF
    
    echo "  ✅ Complete"
    echo ""
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✨ Scraping complete!"
echo ""
echo "📄 Data saved to: $OUTPUT_DIR/"
echo "📝 Summary saved to: $SUMMARY_FILE"
echo ""
echo "💡 Next step: Review $SUMMARY_FILE and update README.md Repository Map section"
