#!/bin/bash
# promptfoo Setup Script for XGate
# Run once to install promptfoo and generate baseline
#
# Prerequisites: Node.js 20+, ANTHROPIC_API_KEY set in environment
#
# Usage: ./promptfoo/setup.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "=== XGate promptfoo Setup ==="
echo ""

# Check Node.js
if ! command -v node &>/dev/null; then
  echo "ERROR: Node.js not found. Install Node.js 20+ first."
  exit 1
fi

echo "Node.js: $(node --version)"
echo ""

# Install promptfoo
echo "Installing promptfoo..."
cd "$PROJECT_ROOT"
npm install -D promptfoo
echo "promptfoo installed."
echo ""

# Check API key
if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "WARNING: ANTHROPIC_API_KEY not set."
  echo "Set it before running evals:"
  echo "  export ANTHROPIC_API_KEY=sk-ant-..."
  echo ""
  exit 1
fi

# Run baseline evals
echo "Running baseline evals (this may take 5-10 minutes)..."
npx promptfoo@latest eval -c promptfoo/promptfoo.config.yaml \
  --output promptfoo/baseline.json \
  --no-cache \
  --progress

echo ""
echo "=== Baseline generated ==="
echo "Results saved to: promptfoo/baseline.json"
echo ""
echo "To run regression checks:"
echo "  npx promptfoo@latest eval -c promptfoo/promptfoo.config.yaml --output promptfoo/latest.json"
echo ""
echo "To view results in browser:"
echo "  npx promptfoo@latest view"
