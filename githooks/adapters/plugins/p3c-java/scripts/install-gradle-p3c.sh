#!/bin/bash
# Install p3c-pmd into a Gradle project for xgate Java quality gate.
# Usage: bash scripts/install-gradle-p3c.sh [project_root]

set -e

PLUGIN_DIR="$(cd "$(dirname "$0")"/.. && pwd)"
PROJECT_ROOT="${1:-.}"

cd "$PROJECT_ROOT"

if [ ! -f "build.gradle" ] && [ ! -f "build.gradle.kts" ]; then
  echo "❌ No build.gradle found in $(pwd)"
  exit 1
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "   XGate: Installing p3c-pmd for Gradle projects"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

GRADLE_FILE=""
if [ -f "build.gradle" ]; then
  GRADLE_FILE="build.gradle"
elif [ -f "build.gradle.kts" ]; then
  GRADLE_FILE="build.gradle.kts"
fi

if grep -q 'xgateP3cCheck\|p3c-pmd' "$GRADLE_FILE" 2>/dev/null; then
  echo "✅ p3c-pmd already configured in $GRADLE_FILE"
  exit 0
fi

echo "ℹ️  Appending p3c-pmd configuration to $GRADLE_FILE..."
{
  echo ""
  echo "// XGate: Alibaba p3c-pmd quality gate"
  echo "apply from: '$PLUGIN_DIR/templates/gradle/xgate-p3c-gradle.gradle'"
  echo ""
} >> "$GRADLE_FILE"

echo ""
echo "✅ p3c-pmd installed successfully!"
echo ""
echo "  # Run: ./gradlew xgateP3cCheck"
