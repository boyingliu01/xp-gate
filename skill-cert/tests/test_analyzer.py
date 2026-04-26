"""Tests for engine/analyzer.py — SKILL.md parsing."""

import pytest
from engine.analyzer import parse_skill_md


class TestParseSkillMd:
    """Test SKILL.md parsing with various formats."""

    def test_parse_minimal_skill(self, tmp_path):
        """Parse a minimal SKILL.md with just name and description."""
        skill_file = tmp_path / "SKILL.md"
        skill_file.write_text("""---
name: test-skill
description: A simple test skill
---
# Test Skill

## Workflow
1. Step one
2. Step two
""")
        result = parse_skill_md(str(skill_file))
        assert result["name"] == "test-skill"
        assert "simple test skill" in result["description"]
        assert len(result["workflow_steps"]) == 2

    def test_parse_full_skill(self, tmp_path):
        """Parse a complete SKILL.md with all sections."""
        skill_file = tmp_path / "SKILL.md"
        skill_file.write_text("""---
name: delphi-review
description: Multi-expert consensus review
---
# Delphi Review

## Workflow
- Phase 0: Preparation
- Round 1: Anonymous review
- Round 2: Consensus check

## Anti-Patterns
| Pattern | Fix |
|---------|-----|
| Skip Round 1 | Always run all rounds |

## Output Format
- Consensus report
- specification.yaml

## Examples
- Review design documents
- Code walkthrough
""")
        result = parse_skill_md(str(skill_file))
        assert result["name"] == "delphi-review"
        assert len(result["workflow_steps"]) == 3
        assert len(result["anti_patterns"]) == 1
        assert len(result["output_format"]) == 2
        assert len(result["examples"]) == 2
        assert result["parse_method"] in ("regex", "hybrid")
        assert result["parse_confidence"] > 0

    def test_parse_no_frontmatter(self, tmp_path):
        """Parse SKILL.md without YAML frontmatter — should fallback."""
        skill_file = tmp_path / "SKILL.md"
        skill_file.write_text("""# My Skill

Some description here.

## Process
1. Do something
""")
        result = parse_skill_md(str(skill_file))
        assert result["name"] == "my-skill"
        assert result["parse_method"] in ("regex", "llm", "hybrid")

    def test_parse_long_skill_truncation(self, tmp_path):
        """Very long SKILL.md should record content_length."""
        skill_file = tmp_path / "SKILL.md"
        content = "---\nname: long-skill\ndescription: test\n---\n" + "# Header\n" * 500
        skill_file.write_text(content)
        result = parse_skill_md(str(skill_file))
        assert result["content_length"] > 0
        assert result["name"] == "long-skill"

    def test_parse_nonexistent_file(self):
        """Should raise FileNotFoundError for missing file."""
        with pytest.raises(FileNotFoundError):
            parse_skill_md("/nonexistent/SKILL.md")
