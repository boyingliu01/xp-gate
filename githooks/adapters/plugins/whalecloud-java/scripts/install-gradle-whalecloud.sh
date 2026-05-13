#!/bin/bash
# Install WhaleCloud Java Coding Standards into a Gradle project.
# Usage: bash scripts/install-gradle-whalecloud.sh [project_root]
set -e

PLUGIN_DIR="$(cd "$(dirname "$0")"/.. && pwd)"
PROJECT_ROOT="${1:-.}"

cd "$PROJECT_ROOT"

if [ ! -f "build.gradle" ] && [ ! -f "build.gradle.kts" ]; then
  echo "❌ No build.gradle or build.gradle.kts found in $(pwd)"
  exit 1
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "   XGate: Installing WhaleCloud Java Coding Standards"
echo "   for Gradle project"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

GRADLE_FILE="build.gradle"
[ -f "build.gradle.kts" ] && GRADLE_FILE="build.gradle.kts"

if grep -q 'xgateWhalecloudCheck\|whalecloud-ruleset' "$GRADLE_FILE"; then
  echo "✅ WhaleCloud standard already configured in $GRADLE_FILE"
  echo ""
  echo "To run: ./gradlew xgateWhalecloudCheck"
  exit 0
fi

echo "Installing into $GRADLE_FILE..."

cat >> "$GRADLE_FILE" << 'APPEND'

// ─── XGate: WhaleCloud Java Coding Standards ───
plugins {
    id 'pmd'
    id 'checkstyle'
    id 'com.github.spotbugs' version '5.2.5'
}

pmd {
    consoleOutput = true
    toolVersion = '7.7.0'
    ruleSetFiles = files('config/pmd/whalecloud-ruleset.xml')
    ruleSets = [
        '/rulesets/java/ali-comment.xml',
        '/rulesets/java/ali-concurrent.xml',
        '/rulesets/java/ali-constant.xml',
        '/rulesets/java/ali-exception.xml',
        '/rulesets/java/ali-flowcontrol.xml',
        '/rulesets/java/ali-naming.xml',
        '/rulesets/java/ali-oop.xml',
        '/rulesets/java/ali-orm.xml',
        '/rulesets/java/ali-other.xml',
        '/rulesets/java/ali-set.xml'
    ]
    sourceSets = [sourceSets.main, sourceSets.test]
}

checkstyle {
    toolVersion = '10.21.3'
    configFile = file('config/checkstyle/whalecloud-checkstyle.xml')
    sourceSets = [sourceSets.main, sourceSets.test]
}

spotbugs {
    toolVersion = '4.7.3'
    includeFilter = file('config/spotbugs/whalecloud-spotbugs.xml')
    effort = 'max'
    reportLevel = 'low'
}

dependencies {
    spotbugsPlugins 'com.h3xstream.findsecbugs:findsecbugs-plugin:1.12.0'
}

task xgateWhalecloudCheck {
    description = 'Run WhaleCloud Java coding standard checks'
    group = 'Verification'
    dependsOn 'pmdMain', 'pmdTest', 'checkstyleMain', 'checkstyleTest', 'spotbugsMain'
}
APPEND

echo ""
echo "✅ WhaleCloud standard installed!"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "   Usage"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  # Run WhaleCloud quality checks:"
echo "  ./gradlew xgateWhalecloudCheck"
echo ""
echo "  # This integrates into xgate pre-commit Gate 1"
echo ""
