#!/bin/bash
# Install p3c-pmd into a Maven project for xgate Java quality gate.
# Usage: bash scripts/install-maven-p3c.sh [project_root]
#
# This script:
# 1. Detects if pom.xml exists
# 2. Merges xgate-p3c profile into pom.xml (or creates profile snippet)
# 3. Outputs instructions for running p3c check

set -e

PLUGIN_DIR="$(cd "$(dirname "$0")"/.. && pwd)"
PROJECT_ROOT="${1:-.}"

cd "$PROJECT_ROOT"

if [ ! -f "pom.xml" ]; then
  echo "❌ No pom.xml found in $(pwd)"
  echo "This script requires a Maven project."
  exit 1
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "   XGate: Installing p3c-pmd for Java quality gate"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

PROFILE_FILE="$PLUGIN_DIR/templates/maven/xgate-p3c-profile.xml"

# Check if p3c profile already exists
if grep -q '<id>xgate-p3c</id>' pom.xml; then
  echo "✅ p3c-pmd profile already exists in pom.xml"
  echo ""
  echo "To run: mvn clean verify -P xgate-p3c"
  exit 0
fi

# Check if pom.xml has a profiles section
if grep -q '<profiles>' pom.xml; then
  # Insert profile before </profiles>
  echo "ℹ️  Merging p3c-pmd profile into existing <profiles> section..."

  # Create a temp file with the profile content
  TEMP_PROFILE=$(mktemp)
  cat "$PROFILE_FILE" > "$TEMP_PROFILE"

  # Use sed to insert before </profiles>
  # Find the line number of </profiles>
  PROFILES_END_LINE=$(grep -n '</profiles>' pom.xml | head -1 | cut -d: -f1)

  if [ -n "$PROFILES_END_LINE" ]; then
    head -n $((PROFILES_END_LINE - 1)) pom.xml > pom.xml.tmp
    {
      echo ""
      echo "    <!-- XGate: Alibaba p3c-pmd quality gate profile -->"
      sed 's/^/    /' "$TEMP_PROFILE"
      echo ""
    } >> pom.xml.tmp
    tail -n +"$PROFILES_END_LINE" pom.xml >> pom.xml.tmp
    mv pom.xml.tmp pom.xml
  fi
else
  # No profiles section, append before </project>
  echo "ℹ️  Appending p3c-pmd profile to pom.xml..."

  PROJECT_END_LINE=$(grep -n '</project>' pom.xml | tail -1 | cut -d: -f1)

  if [ -n "$PROJECT_END_LINE" ]; then
    head -n $((PROJECT_END_LINE - 1)) pom.xml > pom.xml.tmp
    {
      echo ""
      echo "  <!-- XGate: Alibaba p3c-pmd quality gate profile -->"
      echo "  <profiles>"
      sed 's/^/    /' "$PROFILE_FILE"
      echo ""
      echo "  </profiles>"
      echo ""
    } >> pom.xml.tmp
    tail -n +"$PROJECT_END_LINE" pom.xml >> pom.xml.tmp
    mv pom.xml.tmp pom.xml
  fi
fi

echo ""
echo "✅ p3c-pmd profile installed successfully!"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "   Usage"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  # Run p3c-pmd checks:"
echo "  mvn clean verify -P xgate-p3c"
echo ""
echo "  # Run with fail on violation:"
echo "  mvn clean verify -P xgate-p3c -Dpmd.failOnViolation=true"
echo ""
echo "  # This will be integrated into xgate pre-commit Gate 1"
echo ""
