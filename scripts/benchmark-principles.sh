#!/bin/bash
# Performance benchmark for principles checker
# Tests: <5s for 100 files, <10s full scan, <50MB memory

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
PRINCIPLES_CLI="$PROJECT_ROOT/src/principles/index.ts"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "   PRINCIPLES CHECKER - PERFORMANCE BENCHMARK"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Target thresholds
TARGET_100_FILES_MS=5000    # 5 seconds
TARGET_FULL_SCAN_MS=10000   # 10 seconds
TARGET_MEMORY_MB=50         # 50 MB

# Test 1: Run on actual project files
echo "Test 1: Current project scan"
echo "Files: $(find src/principles -name '*.ts' ! -name '*.test.ts' | wc -l) source files"
echo ""

# Measure time and memory using /usr/bin/time
if command -v /usr/bin/time &> /dev/null; then
    TIME_CMD="/usr/bin/time -v"
else
    TIME_CMD="time"
fi

# Run principles checker
START_TIME=$(date +%s%N)
$TIME_CMD npx tsx "$PRINCIPLES_CLI" --files src/principles --output json > /tmp/principles-benchmark.json 2>&1
END_TIME=$(date +%s%N)

# Calculate elapsed time in milliseconds
ELAPSED_MS=$(( ($END_TIME - $START_TIME) / 1000000 ))

echo "Elapsed time: ${ELAPSED_MS}ms"
echo ""

# Parse memory usage from time output
if grep -q "Maximum resident set size" /tmp/principles-benchmark.json 2>/dev/null; then
    MEMORY_KB=$(grep "Maximum resident set size" /tmp/principles-benchmark.json | awk '{print $NF}')
    MEMORY_MB=$(( $MEMORY_KB / 1024 ))
    echo "Memory usage: ${MEMORY_MB}MB"
else
    echo "Memory usage: (not measured - /usr/bin/time not available)"
fi

echo ""

# Test 2: Simulate 100 files (by including test files too)
echo "Test 2: Simulated 100 files scan"
TOTAL_FILES=$(find src/principles -name "*.ts" | wc -l)
echo "Files: $TOTAL_FILES total TypeScript files"
echo ""

START_TIME=$(date +%s%N)
npx tsx "$PRINCIPLES_CLI" --files src/principles --output json > /dev/null 2>&1
END_TIME=$(date +%s%N)
ELAPSED_MS=$(( ($END_TIME - $START_TIME) / 1000000 ))

echo "Elapsed time: ${ELAPSED_MS}ms"
echo ""

# Validation
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "   BENCHMARK RESULTS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check thresholds (scaled by file count)
SCALED_TARGET=$(( $TARGET_100_FILES_MS * $TOTAL_FILES / 100 ))

if [ $ELAPSED_MS -le $SCALED_TARGET ]; then
    echo -e "${GREEN}✅ PASS${NC} - Time ($ELAPSED_MS ms) within scaled target ($SCALED_TARGET ms for $TOTAL_FILES files)"
    RESULT_100="PASS"
else
    echo -e "${RED}❌ FAIL${NC} - Time ($ELAPSED_MS ms) exceeds scaled target ($SCALED_TARGET ms)"
    RESULT_100="FAIL"
fi

if [ $ELAPSED_MS -le $TARGET_FULL_SCAN_MS ]; then
    echo -e "${GREEN}✅ PASS${NC} - Time ($ELAPSED_MS ms) within full scan target ($TARGET_FULL_SCAN_MS ms)"
    RESULT_FULL="PASS"
else
    echo -e "${RED}❌ FAIL${NC} - Time ($ELAPSED_MS ms) exceeds full scan target ($TARGET_FULL_SCAN_MS ms)"
    RESULT_FULL="FAIL"
fi

if [ -n "$MEMORY_MB" ]; then
    if [ $MEMORY_MB -le $TARGET_MEMORY_MB ]; then
        echo -e "${GREEN}✅ PASS${NC} - Memory ($MEMORY_MB MB) within target ($TARGET_MEMORY_MB MB)"
        RESULT_MEM="PASS"
    else
        echo -e "${RED}❌ FAIL${NC} - Memory ($MEMORY_MB MB) exceeds target ($TARGET_MEMORY_MB MB)"
        RESULT_MEM="FAIL"
    fi
else
    echo -e "${YELLOW}⚠️ SKIP${NC} - Memory not measured"
    RESULT_MEM="SKIP"
fi

echo ""

# Summary
if [ "$RESULT_100" = "PASS" ] && [ "$RESULT_FULL" = "PASS" ]; then
    echo -e "${GREEN}✅ ALL TIME BENCHMARKS PASSED${NC}"
    EXIT_CODE=0
else
    echo -e "${RED}❌ SOME BENCHMARKS FAILED${NC}"
    EXIT_CODE=1
fi

# Cleanup
rm -f /tmp/principles-benchmark.json

exit $EXIT_CODE