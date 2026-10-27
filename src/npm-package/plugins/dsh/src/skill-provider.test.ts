/**
 * @test REQ-DSH-006 bundled skill provider
 * @intent Verify the plugin registers a DSH SkillProvider that publishes all 12 bundled
 *         skills with model-visible metadata, correct resourceBase for relative
 *         references/, and a body loader that re-reads from disk each call.
 * @covers AC-DSH-006-01 AC-DSH-006-02 AC-DSH-006-03
 *
 * Why these assertions exist: v1 shipped 65 skill files inside the tarball and still
 * delivered none of them, because the requirement assumed a `bundledSkillDir`
 * discovery root the plugin cannot set itself. A test that only checks "files are
 * present on disk" reproduces that bug, so every assertion here goes through the
 * SkillProvider contract DSH actually consumes.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it, afterAll } from "vitest"

import {
  createSkillProvider,
  listBundledSkills,
} from "./skill-provider.js"
import { BUNDLED_SKILL_RANK } from "@deepseek-ai/dsh-skill"
import type {
  SkillCandidate,
  SkillProvider,
  SkillProviderObservation,
} from "@deepseek-ai/dsh-skill"

const SKILLS_ROOT = fileURLToPath(new URL("../skills/", import.meta.url))

/** The repository ships this many skills; the count is part of the delivery promise. */
const EXPECTED_SKILL_COUNT = 12;

/** A skill body shorter than this is a stub, not a usable instruction set. */
const MIN_SKILL_BODY_CHARS = 200;

/** A description shorter than this cannot route a skill to the right task. */
const MIN_DESCRIPTION_CHARS = 50;

/** Every skill directory shipped in the tarball, read from disk rather than hard-coded. */
const shipped = listBundledSkills(SKILLS_ROOT).map((s) => s.name).sort()

const scratchDirs: string[] = []
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "xp-gate-skill-provider-"))
  scratchDirs.push(dir)
  return dir
}

/**
 * Narrow the dual-shape `list()` return to a plain candidate array.
 * DSH allows a provider to answer with either a bare array or an observation
 * object; this provider always uses the bare array, but the type is a union.
 */
function candidatesOf(
  listed: Awaited<ReturnType<SkillProvider["list"]>>,
): readonly SkillCandidate[] {
  return Array.isArray(listed) ? listed : ((listed as SkillProviderObservation).candidates ?? [])
}

afterAll(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true })
})

describe("bundled skill provider", () => {
  it("discovers all 12 bundled skills", () => {
    expect(shipped).toHaveLength(EXPECTED_SKILL_COUNT)
    expect(shipped).toContain("delphi-review")
    expect(shipped).toContain("sprint-flow")
    expect(shipped).toContain("test-driven-development")
  })

  it("returns candidates carrying the DSH skill contract", async () => {
    const provider = createSkillProvider(SKILLS_ROOT)
    const listed = await provider.list({})
    const candidates = candidatesOf(listed)
    expect(candidates).toBeDefined()
    expect(candidates).toHaveLength(EXPECTED_SKILL_COUNT)

    for (const candidate of candidates) {
      expect(candidate.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      // A blank description makes the skill unroutable: the model never picks it.
      expect(candidate.description.length).toBeGreaterThan(10)
      expect(candidate.invocation).toEqual({
        modelInvocable: true,
        userInvocable: true,
      })
      expect(candidate.provider).toBe("xp-gate")
      expect(candidate.source).toBe("bundled")
      expect(candidate.rank).toBe(BUNDLED_SKILL_RANK)
    }
  })

  it("gives every candidate a directory resourceBase so relative references resolve", () => {
    // 8 of the 12 skills point at references/*.md and templates/*; without
    // resourceBase those paths have no base and the skill dangles.
    const candidates = listBundledSkills(SKILLS_ROOT)
    expect(candidates).toHaveLength(EXPECTED_SKILL_COUNT)
    for (const candidate of candidates) {
      expect(candidate.resourceBase).toBeDefined()
      expect(candidate.resourceBase?.kind).toBe("directory")
      const base = candidate.resourceBase
      if (base?.kind === "directory") {
        expect(base.path).toContain(candidate.name)
      }
    }
  })

  it("loads a non-empty body with the frontmatter stripped", async () => {
    const provider = createSkillProvider(SKILLS_ROOT)
    const listed = await provider.list({})
    const candidates = candidatesOf(listed)
    const target = candidates.find((c) => c.name === "delphi-review")
    expect(target).toBeDefined()
    if (!target) return

    const definition = await provider.get(target, {})
    expect(definition).toBeDefined()
    expect(definition?.name).toBe("delphi-review")
    // The body starts after the YAML block, so the opening `---` must be gone.
    expect(definition?.content ?? "").not.toMatch(/^---/)
    expect((definition?.content ?? "").length).toBeGreaterThan(MIN_SKILL_BODY_CHARS)
    expect(definition?.content).toContain("Delphi")
  })

  it("re-reads the body from disk on each get, so edits apply without a restart", async () => {
    const root = scratch()
    const dir = join(root, "demo-skill")
    const file = join(dir, "SKILL.md")
    try {
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        file,
        "---\nname: demo-skill\ndescription: A demo skill used to prove the body is not cached.\n---\n\n# Original body marker\n",
        "utf8",
      )
    } catch (error) {
      throw new Error(`cannot build scratch skill: ${(error as Error).message}`)
    }

    const provider = createSkillProvider(root)
    const listed = await provider.list({})
    const candidates = candidatesOf(listed)
    const target = candidates[0]
    expect(target).toBeDefined()
    if (!target) return

    const first = await provider.get(target, {})
    expect(first?.content).toContain("Original body marker")

    try {
      writeFileSync(
        file,
        "---\nname: demo-skill\ndescription: A demo skill used to prove the body is not cached.\n---\n\n# Edited body marker\n",
        "utf8",
      )
    } catch (error) {
      throw new Error(`cannot edit scratch skill: ${(error as Error).message}`)
    }

    const second = await provider.get(target, {})
    expect(second?.content).toContain("Edited body marker")
    expect(second?.content).not.toContain("Original body marker")
  })

  it("parses both folded and quoted YAML descriptions", () => {
    // Two shapes ship in this repo: `description: >` blocks (delphi-review,
    // sprint-flow) and one-line quoted values. A parser handling only one shape
    // silently yields an empty description for the other, making the skill
    // invisible to routing.
    const candidates = listBundledSkills(SKILLS_ROOT)
    const folded = candidates.find((c) => c.name === "delphi-review")
    const quoted = candidates.find((c) => c.name === "admin-template-guidelines")

    expect(folded?.description.length).toBeGreaterThan(MIN_DESCRIPTION_CHARS)
    expect(quoted?.description.length).toBeGreaterThan(MIN_DESCRIPTION_CHARS)
    // The folded block must be unfolded into one line, not left with newlines.
    expect(folded?.description).not.toContain("\n")
  })

  it("returns an empty catalog for a missing skills root instead of throwing", async () => {
    const provider = createSkillProvider(join(tmpdir(), "xp-gate-does-not-exist-root"))
    const listed = await provider.list({})
    const candidates = candidatesOf(listed)
    expect(candidates).toHaveLength(0)
  })
})



