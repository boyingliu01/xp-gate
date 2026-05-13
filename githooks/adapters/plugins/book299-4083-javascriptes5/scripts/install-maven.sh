#!/bin/bash
# Auto-generated Maven install script
set -e
PLUGIN_DIR="$(cd "$(dirname "$0")"/.. && pwd)"
PROJECT_ROOT="${1:-.}"
cd "$PROJECT_ROOT"
if [ ! -f "pom.xml" ]; then
  echo "❌ No pom.xml found"
  exit 1
fi
if grep -q "<id>xgate-$(basename "$PLUGIN_DIR")</id>" pom.xml; then
  echo "✅ Already installed"
  exit 0
fi
cat >> pom.xml << 'APPEND'
<!-- Auto-generated XGate plugin profile -->
<!-- See plugin documentation for details -->
<profiles><profile><id>xgate-AUTO</id></profile></profiles>
APPEND
echo "✅ Plugin profile installed"
