"""CLI entry point for skill-cert."""

import argparse
import sys
from pathlib import Path

from engine.analyzer import parse_skill_md


def main():
    parser = argparse.ArgumentParser(
        description="Skill-Cert: AI Skill 评测引擎"
    )
    parser.add_argument(
        "--skill", required=True, help="Path to SKILL.md file"
    )
    parser.add_argument(
        "--models", default="", help="Comma-separated model names"
    )
    parser.add_argument(
        "--output", default="./results", help="Output directory"
    )
    parser.add_argument(
        "--max-total-time", type=int, default=3600, help="Global timeout in seconds"
    )

    args = parser.parse_args()

    # Phase 0: Parse SKILL.md
    print(f"[Phase 0] Parsing SKILL.md: {args.skill}")
    try:
        spec = parse_skill_md(args.skill)
        print(f"  Name: {spec['name']}")
        print(f"  Parse method: {spec['parse_method']}")
        print(f"  Parse confidence: {spec['parse_confidence']:.2f}")
        print(f"  Workflow steps: {len(spec['workflow_steps'])}")
        print(f"  Anti-patterns: {len(spec['anti_patterns'])}")
    except FileNotFoundError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)

    if spec["parse_confidence"] < 0.6:
        print("WARNING: Low parse confidence. Results may be unreliable.")

    print("[Phase 1-6] Remaining phases require model API access.")
    print("Configure models via SKILL_CERT_MODELS env var or ~/.skill-cert/models.yaml")


if __name__ == "__main__":
    main()
