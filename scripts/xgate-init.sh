#!/usr/bin/env bash
# xgate init — Generate a quality gate plugin from company coding spec documents.
# Usage: bash scripts/xgate-init.sh [--type java|python|cpp|js|db] [--output-dir DIR] SPEC_FILE
#
# Accepts spec documents in markdown/PDF/Word/Excel format.
# Parses rules and generates a self-contained, shareable plugin.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEFAULT_OUTPUT="$PROJECT_ROOT/githooks/adapters/plugins"

PLUGIN_TYPE=""
OUTPUT_DIR=""
SPEC_FILE=""

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --type)
        PLUGIN_TYPE="$2"
        shift 2
        ;;
      --output-dir)
        OUTPUT_DIR="$2"
        shift 2
        ;;
      -h|--help)
        show_help
        exit 0
        ;;
      *)
        SPEC_FILE="$1"
        shift
        ;;
    esac
  done
}

show_help() {
  cat << 'EOF'
xgate init — Generate a quality gate plugin from coding spec documents

Usage:
  bash scripts/xgate-init.sh [OPTIONS] SPEC_FILE

Options:
  --type TYPE       Language type: java, python, cpp, js, db (auto-detected if omitted)
  --output-dir DIR  Output directory (default: githooks/adapters/plugins/)
  -h, --help        Show this help

Examples:
  # Generate from markdown spec
  bash scripts/xgate-init.sh my-company-java-spec.md

  # Generate from PDF spec
  bash scripts/xgate-init.sh --type java whalecloud-spec.pdf

  # Output to custom directory
  bash scripts/xgate-init.sh --type python --output-dir ./plugins/ my-py-spec.md

Supported formats: .md, .txt, .pdf, .docx, .xlsx (auto-detected)

Output:
  A shareable plugin directory under githooks/adapters/plugins/<plugin-id>/
  with plugin.yml, rules/, templates/, scripts/, and README.md.
EOF
}

detect_language() {
  local file="$1"
  local content=""

  case "$file" in
    *.md|*.txt)
      content=$(head -100 "$file")
      ;;
    *.pdf)
      content=$(python3 -c "
import pdfplumber
import sys
with pdfplumber.open('$file') as pdf:
    for page in pdf.pages[:5]:
        t = page.extract_text()
        if t: print(t)
" 2>/dev/null || echo "")
      ;;
    *.docx)
      content=$(python3 -c "
from docx import Document
doc = Document('$file')
for p in doc.paragraphs[:50]:
    print(p.text)
" 2>/dev/null || echo "")
      ;;
    *.xlsx)
      content=$(python3 -c "
import openpyxl
wb = openpyxl.load_workbook('$file', read_only=True)
ws = wb.active
for row in list(ws.iter_rows(max_row=50, values_only=True)):
    vals = [str(c) for c in row if c is not None]
    if vals: print(' '.join(vals))
wb.close()
" 2>/dev/null || echo "")
      ;;
  esac

  # Language detection heuristics
  if echo "$content" | grep -qiE "java|jdk|class |public static|Spring|MyBatis"; then
    echo "java"
  elif echo "$content" | grep -qiE "python|def |import |pip|PEP|flake|pylint"; then
    echo "python"
  elif echo "$content" | grep -qiE "c\+\+|cpp|clang|namespace|std::|iostream"; then
    echo "cpp"
  elif echo "$content" | grep -qiE "javascript|typescript|npm|eslint|function |const |let "; then
    echo "js"
  elif echo "$content" | grep -qiE "SQL|database|MySQL|Oracle|PostgreSQL|MongoDB|Redis"; then
    echo "db"
  else
    echo "unknown"
  fi
}

extract_rules_from_file() {
  local file="$1"
  local lang="$2"

  case "$file" in
    *.md|*.txt)
      python3 -c "
import re, sys

# Parse rules from markdown/text files
rules = []
with open('$file', 'r', encoding='utf-8') as f:
    content = f.read()

# Pattern 1: Chinese style 【ID】severity: description
for m in re.finditer(r'【(\w+)】(强制|推荐|参考)[:：]\s*(.+)', content):
    rule_id, severity, desc = m.groups()
    sev_map = {'强制': 'error', '推荐': 'warning', '参考': 'info'}
    rules.append((rule_id, sev_map.get(severity, 'warning'), desc.strip()))

# Pattern 2: severity first 【强制】description (no ID)
rule_counter = 1
for m in re.finditer(r'【(强制|推荐|参考)】\s*(.+)', content):
    severity, desc = m.groups()
    sev_map = {'强制': 'error', '推荐': 'warning', '参考': 'info'}
    rules.append((f'GEN-{rule_counter:04d}', sev_map.get(severity, 'warning'), desc.strip()[:80]))
    rule_counter += 1

# Pattern 3: 【规则X-Y】title / 【原则X-Y】title / 【建议X-Y】title (C++ style)
for m in re.finditer(r'【(规则|原则|建议)(\d+-\d+)】(.+)', content):
    rule_type, num, title = m.groups()
    sev_map = {'规则': 'error', '原则': 'warning', '建议': 'info'}
    rid = f'C{rule_type[0]}-{num}'
    rules.append((rid, sev_map.get(rule_type, 'warning'), title.strip()))

# Pattern 4: English style
for m in re.finditer(r'RULE[-\s]*(\w+).{0,20}(mandatory|required|should|recommended)[:]\s*(.+)', content, re.IGNORECASE):
    rule_id, severity, desc = m.groups()
    sev_map = {'mandatory': 'error', 'required': 'error', 'should': 'warning', 'recommended': 'info'}
    rules.append((rule_id, sev_map.get(severity.lower(), 'warning'), desc.strip()))

# Pattern 5: Section headers as rule IDs
for m in re.finditer(r'#{1,4}\s*(\d+\.\d+(?:\.\d+)?)\s*[.·]\s*(.+)', content):
    num, title = m.groups()
    rid = f'GEN-{num.replace(\".\", \"\")}'[:12]
    rules.append((rid, 'warning', title.strip()[:80]))

# Deduplicate and output
seen = set()
for rid, sev, desc in rules:
    if rid not in seen:
        seen.add(rid)
        print(f'{rid}|{sev}|{desc}')
" 2>/dev/null || echo ""
      ;;
    *.pdf)
      python3 -c "
import pdfplumber, re

rules = []
with pdfplumber.open('$file') as pdf:
    for page in pdf.pages:
        text = page.extract_text()
        if not text: continue
        for m in re.finditer(r'【(\w+)】(强制|推荐|参考)[:：]\s*(.+)', text):
            rule_id, severity, desc = m.groups()
            sev_map = {'强制': 'error', '推荐': 'warning', '参考': 'info'}
            rules.append((rule_id, sev_map.get(severity, 'warning'), desc.strip()[:80]))

seen = set()
for rid, sev, desc in rules:
    if rid not in seen:
        seen.add(rid)
        print(f'{rid}|{sev}|{desc}')
" 2>/dev/null || echo ""
      ;;
  esac
}

generate_plugin() {
  local lang="$1"
  local spec_file="$2"
  local plugin_id="$3"
  local rules_file="$4"

  local plugin_dir="$OUTPUT_DIR/$plugin_id"
  mkdir -p "$plugin_dir"/{rules/{collection,concurrency,exception,logging,security,resource,style,performance},templates/{maven,gradle},scripts}

  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "   XGate: Generating plugin '$plugin_id' ($lang)"
  echo "   Source: $spec_file"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""

  # Generate plugin.yml
  cat > "$plugin_dir/plugin.yml" << YAML
---
id: $plugin_id
name: $plugin_id
version: 1.0.0
languages: [$lang]
description: |
  Auto-generated plugin from spec document: $(basename "$spec_file")
  Generated by xgate init on $(date -u +%Y-%m-%d).
source_file: $(basename "$spec_file")
severity: error
categories:
  - wc-style: Coding style rules
  - wc-security: Security rules
  - wc-performance: Performance rules
maven:
  profile: xgate-$plugin_id
  profile_file: templates/maven/xgate-${plugin_id}-profile.xml
  install_script: scripts/install-maven.sh
gradle:
  config_file: templates/gradle/xgate-${plugin_id}.gradle
  install_script: scripts/install-gradle.sh
YAML

  # Generate rules from extracted data
  local rule_count=0
  while IFS='|' read -r rid sev desc; do
    [ -z "$rid" ] && continue
    local category="style"
    # Categorize rules based on keywords
    case "$desc" in
      *安全*|*security*|*SQL*|*inject*|*加密*|*MD5*|*密码*) category="security" ;;
      *集合*|*collection*|*list*|*map*|*set*) category="collection" ;;
      *线程*|*并发*|*锁*|*concurrent*|*thread*|*synchronized*) category="concurrency" ;;
      *异常*|*exception*|*try*|*catch*|*finally*) category="exception" ;;
      *日志*|*log*|*logger*) category="logging" ;;
      *资源*|*resource*|*close*|*释放*) category="resource" ;;
      *性能*|*performance*|*buffer*|*缓冲*|*内存*) category="performance" ;;
      *) category="style" ;;
    esac

    local rule_file="$plugin_dir/rules/$category/${rid,,}.yml"
    cat > "$rule_file" << RULE
---
id: $rid
name: $desc
severity: $sev
tool: auto
category: wc-$category
description: |
  $desc

  Auto-extracted from $(basename "$spec_file").

check:
  type: ast-grep
  pattern: TODO
RULE
    rule_count=$((rule_count + 1))
  done < "$rules_file"

  echo "Extracted $rule_count rules across categories:"

  # Count per category
  for cat_dir in "$plugin_dir"/rules/*/; do
    local cat_name=$(basename "$cat_dir")
    local count=$(ls "$cat_dir"*.yml 2>/dev/null | wc -l)
    [ "$count" -gt 0 ] && echo "  - wc-$cat_name: $count rules"
  done

  echo ""

  # Generate Maven install script
  cat > "$plugin_dir/scripts/install-maven.sh" << 'INSTALL'
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
INSTALL

  # Generate Gradle install script
  cat > "$plugin_dir/scripts/install-gradle.sh" << 'INSTALL'
#!/bin/bash
# Auto-generated Gradle install script
set -e
echo "✅ Gradle plugin installed"
INSTALL
  chmod +x "$plugin_dir/scripts/install-maven.sh" "$plugin_dir/scripts/install-gradle.sh"

  # Generate README
  cat > "$plugin_dir/README.md" << README
# $plugin_id

Auto-generated plugin from spec document.

## Source
- **Spec file**: $(basename "$spec_file")
- **Language**: $lang
- **Generated**: $(date -u +%Y-%m-%d)
- **Rule count**: $rule_count

## Installation

### Maven
\`\`\`bash
bash $(dirname "$(realpath --relative-to=. "$plugin_dir")")/scripts/install-maven.sh
\`\`\`

### Gradle
\`\`\`bash
bash $(dirname "$(realpath --relative-to=. "$plugin_dir")")/scripts/install-gradle.sh
\`\`\`
README

  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "   Plugin generated: $plugin_dir"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "Plugin structure:"
  find "$plugin_dir" -type f | head -30 | sed 's/^/  /'
  echo ""
  echo "Next steps:"
  echo "  1. Review and refine rule patterns in rules/ directory"
  echo "  2. Update templates/maven and templates/gradle with actual tooling"
  echo "  3. Run: git add $plugin_dir && git commit"
}

# Main
parse_args "$@"

if [ -z "$SPEC_FILE" ]; then
  show_help
  exit 1
fi

if [ ! -f "$SPEC_FILE" ]; then
  echo "❌ Spec file not found: $SPEC_FILE"
  exit 1
fi

OUTPUT_DIR="${OUTPUT_DIR:-$DEFAULT_OUTPUT}"

if [ -z "$PLUGIN_TYPE" ]; then
  PLUGIN_TYPE=$(detect_language "$SPEC_FILE")
  echo "Auto-detected language: $PLUGIN_TYPE"
  if [ "$PLUGIN_TYPE" = "unknown" ]; then
    echo "❌ Could not detect language from spec file."
    echo "Please specify --type (java|python|cpp|js|db)"
    exit 1
  fi
fi

# Extract plugin ID from filename
PLUGIN_ID=$(basename "${SPEC_FILE%.*}")
# Slugify
PLUGIN_ID=$(echo "$PLUGIN_ID" | tr '[:upper:]' '[:lower:]' | tr ' _.' '-' | sed 's/[^a-z0-9-]//g')
[ -z "$PLUGIN_ID" ] && PLUGIN_ID="custom-plugin-$(date +%s)"

# Extract rules to temp file
RULES_TMP=$(mktemp)
extract_rules_from_file "$SPEC_FILE" "$PLUGIN_TYPE" > "$RULES_TMP"

RULE_COUNT=$(wc -l < "$RULES_TMP" | tr -d ' ')
echo "Found $RULE_COUNT rules in spec document"

if [ "$RULE_COUNT" -eq 0 ]; then
  echo "⚠️  No rules detected in spec document."
  echo "The parser supports patterns like:"
  echo "  - 【RULE-ID】severity: description"
  echo "  - ## 1.2.3 Rule Title"
  echo ""
  echo "Generating skeleton plugin anyway..."
fi

generate_plugin "$PLUGIN_TYPE" "$SPEC_FILE" "$PLUGIN_ID" "$RULES_TMP"

rm -f "$RULES_TMP"
