import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, existsSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parse } from "yaml"

/** Mirrors `SKILL_NAME` in @deepseek-ai/dsh-skill. */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const EXPECTED_SKILLS = [
  "admin-template-guidelines",
  "batch-grill-me",
  "delphi-review",
  "domain-modeling",
  "grilling",
  "grill-with-docs",
  "improve-codebase-architecture",
  "ralph-loop",
  "sprint-flow",
  "test-driven-development",
  "test-specification-alignment",
  "to-issues",
]

const SKILLS_DIR = resolve(fileURLToPath(new URL("..", import.meta.url)), "skills")

function readFrontmatter(file: string): Record<string, unknown> {
  const raw = readFileSync(file, "utf8")
  const m = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n/)
  if (!m) throw new Error(`${file}: missing YAML frontmatter`)
  return parse(m[1]) as Record<string, unknown>
}

describe("bundled skills", () => {
  it("ships all 12 skills as directories", () => {
    expect(existsSync(SKILLS_DIR)).toBe(true)
    const dirs = readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
    expect(dirs).toEqual([...EXPECTED_SKILLS].sort())
  })

  /**
   * @test REQ-DSH-006
   * @intent 验证随包 12 个 skills 目录里各 SKILL.md 的 frontmatter 满足 DSH 契约（name kebab-case + description 非空）
   * @covers AC-DSH-006-01
   */
  it("every SKILL.md satisfies the DSH frontmatter contract", () => {
    for (const name of EXPECTED_SKILLS) {
      const fm = readFrontmatter(join(SKILLS_DIR, name, "SKILL.md"))
      expect(fm.name, `${name}: frontmatter.name`).toBeTypeOf("string")
      expect(SKILL_NAME.test(fm.name as string), `${name}: kebab-case name`).toBe(true)
      expect(fm.description, `${name}: frontmatter.description`).toBeTypeOf("string")
      expect((fm.description as string).trim().length, `${name}: non-empty description`).toBeGreaterThan(0)
    }
  })
})