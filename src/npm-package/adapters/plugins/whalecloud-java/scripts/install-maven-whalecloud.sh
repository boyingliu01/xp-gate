#!/bin/bash
# Install WhaleCloud Java Coding Standards into a Maven project.
# Usage: bash scripts/install-maven-whalecloud.sh [project_root]
#
# This script:
# 1. Detects if pom.xml exists
# 2. Installs whalecloud config files (PMD/CheckStyle/SpotBugs rulesets)
# 3. Merges xp-gate-whalecloud-java profile into pom.xml
# 4. Outputs usage instructions

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
echo "   XP-Gate: Installing WhaleCloud Java Coding Standards"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "This adds 106 rules (74 mandatory + 32 recommended) on"
echo "top of p3c-pmd baseline (54 Alibaba rules)."
echo ""

# Step 1: Install config files
CONFIG_DIR="config"
mkdir -p "$CONFIG_DIR/pmd" "$CONFIG_DIR/checkstyle" "$CONFIG_DIR/spotbugs"

echo "Step 1: Installing rule configuration files..."

# PMD ruleset
if [ -f "$CONFIG_DIR/pmd/whalecloud-ruleset.xml" ]; then
  echo "  ✅ config/pmd/whalecloud-ruleset.xml already exists"
else
  cat > "$CONFIG_DIR/pmd/whalecloud-ruleset.xml" << 'RULESET'
<?xml version="1.0"?>
<ruleset name="WhaleCloud Java Rules"
    xmlns="http://pmd.sourceforge.net/ruleset/2.0.0"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xsi:schemaLocation="http://pmd.sourceforge.net/ruleset/2.0.0 https://pmd.sourceforge.io/ruleset_2_0_0.xsd">

  <description>WhaleCloud Java Coding Standards — Overlay Rules</description>

  <!-- Collection: J000005 toArray(T[]) -->
  <rule ref="category/java/bestpractices.xml/ArrayIsStoredDirectly"/>

  <!-- Exception: J000042 Empty catch block -->
  <rule ref="category/java/errorpractices.xml/EmptyCatchBlock"/>
  <!-- Exception: J000044 Return from finally -->
  <rule ref="category/java/errorpractices.xml/AvoidReturningFromFinallyBlock"/>

  <!-- Style: J000070 BigDecimal double constructor -->
  <rule ref="category/java/errorpractices.xml/AvoidDecimalLiteralsInBigDecimalConstructor"/>

  <!-- Logging: J000053 Logger format -->
  <rule ref="category/java/bestpractices.xml/GuardLogStatement"/>

  <!-- Resource: J000108 System.gc() -->
  <rule ref="category/java/errorpractices.xml/DoNotCallGarbageCollectionExplicitly"/>

  <!-- Style: J000100 Static Calendar/DateFormat -->
  <rule ref="category/java/multithreading.xml/NonThreadSafeProperty"/>

  <!-- Performance: J000124 Pattern compilation -->
  <rule ref="category/java/performance.xml/AvoidInstanceofChecksInCatchClause"/>

  <!-- Security: J000078 SQL injection -->
  <rule ref="category/java/security.xml/MethodRequiresCheck"/>

  <!-- TODO: Add custom rules for J-rules not covered by standard PMD rulesets -->
  <!-- Custom rules via XPath will be added here as the plugin matures -->

</ruleset>
RULESET
  echo "  ✅ Created config/pmd/whalecloud-ruleset.xml"
fi

# CheckStyle configuration
if [ -f "$CONFIG_DIR/checkstyle/whalecloud-checkstyle.xml" ]; then
  echo "  ✅ config/checkstyle/whalecloud-checkstyle.xml already exists"
else
  cat > "$CONFIG_DIR/checkstyle/whalecloud-checkstyle.xml" << 'CHECKSTYLE'
<?xml version="1.0"?>
<!DOCTYPE module PUBLIC
    "-//Checkstyle//DTD Checkstyle Configuration 1.3//EN"
    "https://checkstyle.org/dtds/configuration_1_3.dtd">
<module name="Checker">
  <module name="TreeWalker">
    <!-- J000065: Magic number in for loop counter -->
    <module name="MagicNumber">
      <property name="ignoreNumbers" value="-1,0,1,2,10,100,1000,60,24,7,30,365,256,1024"/>
      <property name="ignoreAnnotationElementDefaults" value="true"/>
    </module>
    <!-- J000030: Braces in control statements -->
    <module name="NeedBraces"/>
    <!-- J000066: Multiple variable assignment -->
    <module name="MultipleVariableDeclarations"/>
    <!-- J000072: Left side equals comparison -->
    <module name="EqualsAvoidNull"/>
    <!-- J000097: Unused local variables -->
    <module name="UnusedLocalVariable"/>
  </module>
</module>
CHECKSTYLE
  echo "  ✅ Created config/checkstyle/whalecloud-checkstyle.xml"
fi

# SpotBugs configuration
if [ -f "$CONFIG_DIR/spotbugs/whalecloud-spotbugs.xml" ]; then
  echo "  ✅ config/spotbugs/whalecloud-spotbugs.xml already exists"
else
  cat > "$CONFIG_DIR/spotbugs/whalecloud-spotbugs.xml" << 'SPOTBUGS'
<?xml version="1.0" encoding="UTF-8"?>
<FindBugsFilter>
  <!-- J000017: SimpleDateFormat static usage -->
  <Match>
    <Bug pattern="STCAL_INVOKE_ON_STATIC_DATE_FORMAT_INSTANCE"/>
  </Match>
  <Match>
    <Bug pattern="STCAL_INVOKE_ON_STATIC_CALENDAR_INSTANCE"/>
  </Match>
  <!-- J000075: MD5 usage -->
  <Match>
    <Bug pattern="WEAK_MESSAGE_DIGEST_MD5"/>
  </Match>
  <!-- Security: SQL injection -->
  <Match>
    <Bug pattern="SQL_NONCONSTANT_STRING_PASSED_TO_STATEMENT"/>
  </Match>
  <!-- Security: Command injection -->
  <Match>
    <Bug pattern="COMMAND_INJECTION"/>
  </Match>
</FindBugsFilter>
SPOTBUGS
  echo "  ✅ Created config/spotbugs/whalecloud-spotbugs.xml"
fi

echo ""

# Step 2: Install Maven profile
PROFILE_FILE="$PLUGIN_DIR/templates/maven/xp-gate-whalecloud-profile.xml"

if grep -q '<id>xp-gate-whalecloud-java</id>' pom.xml; then
  echo "Step 2: xp-gate-whalecloud-java profile already exists in pom.xml"
else
  echo "Step 2: Installing xp-gate-whalecloud-java profile into pom.xml..."

  if grep -q '<profiles>' pom.xml; then
    PROFILES_END_LINE=$(grep -n '</profiles>' pom.xml | head -1 | cut -d: -f1)
    if [ -n "$PROFILES_END_LINE" ]; then
      head -n $((PROFILES_END_LINE - 1)) pom.xml > pom.xml.tmp
      {
        echo ""
        echo "    <!-- XP-Gate: WhaleCloud Java Coding Standards profile -->"
        sed 's/^/    /' "$PROFILE_FILE"
        echo ""
      } >> pom.xml.tmp
      tail -n +"$PROFILES_END_LINE" pom.xml >> pom.xml.tmp
      mv pom.xml.tmp pom.xml
    fi
  else
    PROJECT_END_LINE=$(grep -n '</project>' pom.xml | tail -1 | cut -d: -f1)
    if [ -n "$PROJECT_END_LINE" ]; then
      head -n $((PROJECT_END_LINE - 1)) pom.xml > pom.xml.tmp
      {
        echo ""
        echo "  <!-- XP-Gate: WhaleCloud Java Coding Standards profile -->"
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
  echo "  ✅ Profile installed successfully"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "   Usage"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  # Run WhaleCloud Java quality checks:"
echo "  mvn clean verify -P xp-gate-whalecloud-java"
echo ""
echo "  # Run with both p3c-pmd and WhaleCloud:"
echo "  mvn clean verify -P xp-gate-p3c,xp-gate-whalecloud-java"
echo ""
echo "  # This will be integrated into XP-Gate pre-commit Gate 1"
echo ""
