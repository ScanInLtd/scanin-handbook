#!/bin/bash

# Script to analyze ScanIn repository code structure and generate Repository Map summaries
# Focus: Actual code, configs, package files - NOT READMEs
# Extracts: runtime signals, dependencies, entry points, deployment configs

set -e

echo "🔍 Analyzing Repository Code Structure..."
echo ""

ORG="ScanInLtd"
OUTPUT_DIR="./repo-data"
ANALYSIS_FILE="./repo-analysis.md"

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Active repos to analyze (excluding archive-* repos)
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

echo "🔍 Analyzing ${#repos[@]} repositories..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Clear previous analysis
> "$ANALYSIS_FILE"

for repo in "${repos[@]}"; do
    echo "📦 Analyzing: $repo"
    
    repo_dir="$OUTPUT_DIR/$repo"
    mkdir -p "$repo_dir"
    
    # Fetch repo metadata
    echo "  → Fetching metadata..."
    gh api "/repos/$ORG/$repo" > "$repo_dir/metadata.json" 2>/dev/null || echo "{}" > "$repo_dir/metadata.json"
    
    # Get basic info
    description=$(jq -r '.description // "No description"' "$repo_dir/metadata.json")
    language=$(jq -r '.language // "Unknown"' "$repo_dir/metadata.json")
    
    # Fetch directory structure
    echo "  → Analyzing directory structure..."
    gh api "/repos/$ORG/$repo/contents" 2>/dev/null > "$repo_dir/root_contents.json" || echo "[]" > "$repo_dir/root_contents.json"
    
    # Fetch package.json (Node.js/TypeScript projects)
    echo "  → Checking package.json..."
    gh api "/repos/$ORG/$repo/contents/package.json" --jq '.content' 2>/dev/null | base64 -d 2>/dev/null > "$repo_dir/package.json" || echo "{}" > "$repo_dir/package.json"
    
    # Fetch Dockerfile (containerized services)
    echo "  → Checking Dockerfile..."
    gh api "/repos/$ORG/$repo/contents/Dockerfile" --jq '.content' 2>/dev/null | base64 -d 2>/dev/null > "$repo_dir/Dockerfile" || echo "" > "$repo_dir/Dockerfile"
    
    # Fetch docker-compose.yml
    echo "  → Checking docker-compose.yml..."
    gh api "/repos/$ORG/$repo/contents/docker-compose.yml" --jq '.content' 2>/dev/null | base64 -d 2>/dev/null > "$repo_dir/docker-compose.yml" || echo "" > "$repo_dir/docker-compose.yml"
    
    # Fetch platformio.ini (ESP32 firmware)
    echo "  → Checking platformio.ini..."
    gh api "/repos/$ORG/$repo/contents/platformio.ini" --jq '.content' 2>/dev/null | base64 -d 2>/dev/null > "$repo_dir/platformio.ini" || echo "" > "$repo_dir/platformio.ini"
    
    # Fetch pubspec.yaml (Flutter)
    echo "  → Checking pubspec.yaml..."
    gh api "/repos/$ORG/$repo/contents/pubspec.yaml" --jq '.content' 2>/dev/null | base64 -d 2>/dev/null > "$repo_dir/pubspec.yaml" || echo "" > "$repo_dir/pubspec.yaml"
    
    # Fetch firebase.json (Firebase projects)
    echo "  → Checking firebase.json..."
    gh api "/repos/$ORG/$repo/contents/firebase.json" --jq '.content' 2>/dev/null | base64 -d 2>/dev/null > "$repo_dir/firebase.json" || echo "" > "$repo_dir/firebase.json"
    
    # Fetch angular.json (Angular projects)
    echo "  → Checking angular.json..."
    gh api "/repos/$ORG/$repo/contents/angular.json" --jq '.content' 2>/dev/null | base64 -d 2>/dev/null > "$repo_dir/angular.json" || echo "" > "$repo_dir/angular.json"
    
    # Fetch .csproj (C# projects)
    echo "  → Checking for .csproj..."
    csproj_file=$(gh api "/repos/$ORG/$repo/contents" 2>/dev/null | jq -r '.[] | select(.name | endswith(".csproj")) | .name' | head -n 1)
    if [ -n "$csproj_file" ]; then
        gh api "/repos/$ORG/$repo/contents/$csproj_file" --jq '.content' 2>/dev/null | base64 -d 2>/dev/null > "$repo_dir/project.csproj" || echo "" > "$repo_dir/project.csproj"
    else
        echo "" > "$repo_dir/project.csproj"
    fi
    
    # Analyze and write findings
    cat >> "$ANALYSIS_FILE" << EOF

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## $repo

**GitHub Description:** $description
**Primary Language:** $language

### Code Structure Analysis

**Root Directory:**
$(jq -r '.[] | "  - \(.type): \(.name)"' "$repo_dir/root_contents.json" 2>/dev/null | head -n 20)

### Runtime Signals

EOF

    # Analyze package.json
    if [ -s "$repo_dir/package.json" ] && [ "$(jq -r '.name' "$repo_dir/package.json" 2>/dev/null)" != "null" ]; then
        cat >> "$ANALYSIS_FILE" << EOF
**Node.js/TypeScript Project**
- Package: $(jq -r '.name // "unknown"' "$repo_dir/package.json")
- Main: $(jq -r '.main // "N/A"' "$repo_dir/package.json")
- Scripts:
$(jq -r '.scripts | to_entries[] | "  - \(.key): \(.value)"' "$repo_dir/package.json" 2>/dev/null | head -n 10)
- Key Dependencies:
$(jq -r '.dependencies | to_entries[] | "  - \(.key): \(.value)"' "$repo_dir/package.json" 2>/dev/null | head -n 15)

EOF
    fi
    
    # Analyze Dockerfile
    if [ -s "$repo_dir/Dockerfile" ]; then
        cat >> "$ANALYSIS_FILE" << EOF
**Containerized (Docker)**
- Base Image: $(grep -m 1 "^FROM" "$repo_dir/Dockerfile" 2>/dev/null || echo "N/A")
- Exposed Ports: $(grep "^EXPOSE" "$repo_dir/Dockerfile" 2>/dev/null | awk '{print $2}' | tr '\n' ', ' || echo "N/A")
- Entry Point: $(grep "^CMD\|^ENTRYPOINT" "$repo_dir/Dockerfile" 2>/dev/null | head -n 1 || echo "N/A")

EOF
    fi
    
    # Analyze platformio.ini
    if [ -s "$repo_dir/platformio.ini" ]; then
        cat >> "$ANALYSIS_FILE" << EOF
**ESP32 Firmware (PlatformIO)**
- Platform: $(grep "^platform" "$repo_dir/platformio.ini" 2>/dev/null | head -n 1 || echo "N/A")
- Board: $(grep "^board" "$repo_dir/platformio.ini" 2>/dev/null | head -n 1 || echo "N/A")
- Framework: $(grep "^framework" "$repo_dir/platformio.ini" 2>/dev/null | head -n 1 || echo "N/A")

EOF
    fi
    
    # Analyze pubspec.yaml
    if [ -s "$repo_dir/pubspec.yaml" ]; then
        cat >> "$ANALYSIS_FILE" << EOF
**Flutter Application**
- App Name: $(grep "^name:" "$repo_dir/pubspec.yaml" 2>/dev/null | awk '{print $2}' || echo "N/A")
- Description: $(grep "^description:" "$repo_dir/pubspec.yaml" 2>/dev/null | cut -d: -f2- || echo "N/A")

EOF
    fi
    
    # Analyze firebase.json
    if [ -s "$repo_dir/firebase.json" ]; then
        cat >> "$ANALYSIS_FILE" << EOF
**Firebase Project**
- Functions: $(jq -r 'if .functions then "✓" else "✗" end' "$repo_dir/firebase.json" 2>/dev/null)
- Hosting: $(jq -r 'if .hosting then "✓" else "✗" end' "$repo_dir/firebase.json" 2>/dev/null)
- Firestore: $(jq -r 'if .firestore then "✓" else "✗" end' "$repo_dir/firebase.json" 2>/dev/null)

EOF
    fi
    
    # Analyze angular.json
    if [ -s "$repo_dir/angular.json" ]; then
        cat >> "$ANALYSIS_FILE" << EOF
**Angular Application**
- Project: $(jq -r '.projects | keys[0]' "$repo_dir/angular.json" 2>/dev/null || echo "N/A")
- Build Output: $(jq -r '.projects[].architect.build.options.outputPath // "N/A"' "$repo_dir/angular.json" 2>/dev/null | head -n 1)

EOF
    fi
    
    # Analyze .csproj
    if [ -s "$repo_dir/project.csproj" ]; then
        cat >> "$ANALYSIS_FILE" << EOF
**C# .NET Project**
- Target Framework: $(grep -oP '(?<=<TargetFramework>)[^<]+' "$repo_dir/project.csproj" 2>/dev/null | head -n 1 || echo "N/A")
- Output Type: $(grep -oP '(?<=<OutputType>)[^<]+' "$repo_dir/project.csproj" 2>/dev/null | head -n 1 || echo "N/A")

EOF
    fi
    
    echo "  ✅ Complete"
    echo ""
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✨ Analysis complete!"
echo ""
echo "📄 Data saved to: $OUTPUT_DIR/"
echo "📝 Analysis saved to: $ANALYSIS_FILE"
echo ""
echo "💡 Next step: Review $ANALYSIS_FILE for accurate repo insights based on actual code"
