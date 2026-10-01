import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, existsSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parse } from "yaml"

/** Mirrors `SKILL_NAME` in @deepseek-ai/dsh-skill. */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const PLUGIN_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const SKILLS_DIR = join(PLUGIN_ROOT, "skills")
const REPO_SKILLS_DIR = resolve(PLUGIN_ROOT, "..", "..", "skills")

/**
 * The expected set is the REPO's skill directories, discovered rather than
 * hardcoded. A hardcoded list silently drifts: it previously named 12 skills and
 * omitted clipboard-vision, while prepack shipped 12 of 13 (#448).
 */
function repoSkills(): string[] {
  return readdirSync(REPO_SKILLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => existsSync(join(REPO_SKILLS_DIR, name, "SKILL.md")))
    .sort()
}

function readFrontmatter(file: string): Record<string, unknown> {
  const raw = readFileSync(file, "utf8")
  const m = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n/)
  if (!m) throw new Error(`${file}: missing YAML frontmatter`)
  return parse(m[1]) as Record<string, unknown>
}

describe("bundled skills", () => {
  it("ships every repo skill as a directory", () => {
    expect(existsSync(SKILLS_DIR)).toBe(true)
    const dirs = readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
    expect(dirs).toEqual(repoSkills())
  })

  /**
   * @test REQ-DSH-006
   * @intent 验证随包 skills 目录里各 SKILL.md 的 frontmatter 满足 DSH 契约
   *         （name kebab-case + description 非空），且集合与仓库 skills/ 一致（#448）
   * @covers AC-DSH-006-01
   */
  it("every SKILL.md satisfies the DSH frontmatter contract", () => {
    const names = repoSkills()
    expect(names.length).toBeGreaterThan(0)
    for (const name of names) {
      const fm = readFrontmatter(join(SKILLS_DIR, name, "SKILL.md"))
      expect(fm.name, `${name}: frontmatter.name`).toBeTypeOf("string")
      expect(SKILL_NAME.test(fm.name as string), `${name}: kebab-case name`).toBe(true)
      expect(fm.description, `${name}: frontmatter.description`).toBeTypeOf("string")
      expect((fm.description as string).trim().length, `${name}: non-empty description`).toBeGreaterThan(0)
    }
  })

  it("bundles clipboard-vision, which the old hardcoded list omitted (#448)", () => {
    expect(existsSync(join(SKILLS_DIR, "clipboard-vision", "SKILL.md"))).toBe(true)
  })
})