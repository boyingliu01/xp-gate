"""SKILL.md parser — extracts structured semantic model from markdown skill files."""

import re
import json
from pathlib import Path

from markdown_it import MarkdownIt
from pydantic import BaseModel, Field


class WorkflowStep(BaseModel):
    name: str
    step_type: str = Field(alias="type", default="unknown")
    critical: bool = False


class SkillSpec(BaseModel):
    name: str
    description: str = ""
    triggers: list[str] = Field(default_factory=list)
    workflow_steps: list[WorkflowStep] = Field(default_factory=list)
    anti_patterns: list[str] = Field(default_factory=list)
    output_format: list[str] = Field(default_factory=list)
    examples: list[str] = Field(default_factory=list)
    content_length: int = 0
    parse_method: str = "regex"
    parse_confidence: float = 0.0


def parse_skill_md(file_path: str) -> dict:
    """Parse a SKILL.md file and return structured SkillSpec as dict."""
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"SKILL.md not found: {file_path}")

    content = path.read_text(encoding="utf-8")
    spec = SkillSpec(name="unknown", content_length=len(content))

    # Step 1: Extract YAML frontmatter
    frontmatter = _extract_frontmatter(content)
    if frontmatter:
        spec.name = frontmatter.get("name", "unknown")
        spec.description = frontmatter.get("description", "")
    else:
        # Fallback: extract name from first heading
        heading_match = re.search(r"^#\s+(.+)$", content, re.MULTILINE)
        if heading_match:
            spec.name = heading_match.group(1).strip().lower().replace(" ", "-")

    # Step 2: AST-based structure validation with markdown-it-py
    md = MarkdownIt("commonmark")
    tokens = md.parse(content)
    headings = _extract_headings(tokens)

    # Step 3: Regex extraction of key sections
    workflow_steps = _extract_workflow_steps(content)
    anti_patterns = _extract_anti_patterns(content)
    output_format = _extract_output_format(content)
    triggers = _extract_triggers(content, spec.description)
    examples = _extract_examples(content)

    spec.workflow_steps = workflow_steps
    spec.anti_patterns = anti_patterns
    spec.output_format = output_format
    spec.triggers = triggers
    spec.examples = examples

    # Step 4: Calculate parse confidence
    spec.parse_confidence = _calculate_confidence(
        has_frontmatter=bool(frontmatter),
        has_workflow=bool(workflow_steps),
        has_headings=bool(headings),
    )

    # Step 5: Determine parse method
    if spec.parse_confidence >= 0.6 and frontmatter:
        spec.parse_method = "regex"
    else:
        spec.parse_method = "hybrid"  # Would fallback to LLM in production

    return spec.model_dump(by_alias=True)


def _extract_frontmatter(content: str) -> dict | None:
    """Extract YAML frontmatter between --- delimiters."""
    match = re.match(r"^---\n(.*?)\n---", content, re.DOTALL)
    if not match:
        return None
    result = {}
    for line in match.group(1).split("\n"):
        if ":" in line:
            key, _, value = line.partition(":")
            result[key.strip()] = value.strip().strip('"').strip("'")
    return result


def _extract_headings(tokens: list) -> list[dict]:
    """Extract headings from markdown-it-py tokens for AST validation."""
    return [
        {"level": t.tag.replace("h", ""), "content": t.content}
        for t in tokens
        if t.type == "heading_open"
    ]


def _extract_workflow_steps(content: str) -> list[WorkflowStep]:
    """Extract workflow steps from ## Workflow/Process/Flow sections."""
    pattern = r"##\s+(?:Workflow|Process|Flow|Core Workflow)\s*\n(.*?)(?=##\s|\Z)"
    match = re.search(pattern, content, re.IGNORECASE | re.DOTALL)
    if not match:
        return []

    section = match.group(1)
    steps = []
    for line in section.split("\n"):
        line = line.strip()
        # Match numbered list: "1. Step name" or "- Step name"
        m = re.match(r"^(?:\d+\.|-)\s+(.+)$", line)
        if m:
            name = m.group(1).strip()
            steps.append(WorkflowStep(name=name, step_type="unknown", critical=False))
    return steps


def _extract_anti_patterns(content: str) -> list[str]:
    """Extract anti-patterns from ## Anti-Patterns sections."""
    pattern = r"##\s+Anti-Patterns\s*\n(.*?)(?=##\s|\Z)"
    match = re.search(pattern, content, re.IGNORECASE | re.DOTALL)
    if not match:
        return []

    section = match.group(1)
    patterns = []
    for line in section.split("\n"):
        line = line.strip()
        if line.startswith("|") and "---" not in line:
            parts = [p.strip() for p in line.split("|") if p.strip()]
            # Skip table header row
            if parts and parts[0].lower() not in ("pattern", "pattern/anti-pattern", "anti-pattern"):
                patterns.append(parts[0])
    return patterns


def _extract_output_format(content: str) -> list[str]:
    """Extract output format from ## Output Format sections."""
    pattern = r"##\s+Output Format\s*\n(.*?)(?=##\s|\Z)"
    match = re.search(pattern, content, re.IGNORECASE | re.DOTALL)
    if not match:
        return []

    section = match.group(1)
    outputs = []
    for line in section.split("\n"):
        line = line.strip()
        if line.startswith("-") or line.startswith("*"):
            outputs.append(line[1:].strip())
    return outputs


def _extract_triggers(content: str, description: str) -> list[str]:
    """Extract trigger keywords from description and common patterns."""
    triggers = []
    if description:
        # Extract action verbs from description
        verbs = re.findall(r"\b(\w+)\s+(this|the|a|an)\b", description.lower())
        triggers.extend([v[0] for v in verbs])
    return list(set(triggers))


def _extract_examples(content: str) -> list[str]:
    """Extract examples from ## Examples sections."""
    pattern = r"##\s+Examples?\s*\n(.*?)(?=##\s|\Z)"
    match = re.search(pattern, content, re.IGNORECASE | re.DOTALL)
    if not match:
        return []

    section = match.group(1)
    examples = []
    for line in section.split("\n"):
        line = line.strip()
        if line.startswith("-") or line.startswith("*"):
            examples.append(line[1:].strip())
    return examples


def _calculate_confidence(
    has_frontmatter: bool,
    has_workflow: bool,
    has_headings: bool,
) -> float:
    """Calculate parse confidence based on extracted fields."""
    score = 0.0
    if has_frontmatter:
        score += 0.4
    if has_workflow:
        score += 0.3
    if has_headings:
        score += 0.3
    return score
