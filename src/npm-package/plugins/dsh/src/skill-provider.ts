import { readdirSync, readFileSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

import { BUNDLED_SKILL_RANK } from "@deepseek-ai/dsh-skill"
import type {
  SkillCandidate,
  SkillDefinition,
  SkillLookupOptions,
  SkillProvider,
} from "@deepseek-ai/dsh-skill"

/**
 * Provider label surfaced to the model alongside each skill.
 * Matches the plugin name so a loaded skill is attributable.
 */
const PROVIDER_NAME = "xp-gate"

/** Files a skill directory must contain to be loadable. */
const SKILL_FILE = "SKILL.md"

/** The `---` line that opens and closes a SKILL.md YAML frontmatter block. */
const FRONTMATTER_FENCE = "---"

/** Offset just past the opening fence, and past the closing fence plus its newline. */
const FRONTMATTER_START = FRONTMATTER_FENCE.length
const FRONTMATTER_END_OFFSET = FRONTMATTER_FENCE.length + 1

interface ParsedSkill {
  readonly name: string
  readonly description: string
  readonly content: string
}

/**
 * Unfold a YAML block scalar (`key: >` / `key: |`) body into one line.
 * Folded blocks join on spaces, literal blocks on newlines.
 */
function unfoldBlock(lines: readonly string[], literal: boolean): string {
  const trimmed = lines.map((line) => line.trim())
  if (literal) return trimmed.filter((line) => line.length > 0).join("\n")
  return trimmed.filter((line) => line.length > 0).join(" ")
}

/**
 * Extract `name` and `description` from a SKILL.md frontmatter block.
 *
 * Two description shapes ship in this repository: folded blocks
 * (`description: >`) used by delphi-review and sprint-flow, and one-line quoted
 * or plain values used by the rest. A parser handling only one shape yields an
 * empty description for the other, which makes those skills unroutable — the
 * model never picks a skill it cannot see described.
 */
function parseSkill(raw: string, file: string): ParsedSkill {
  if (!raw.startsWith(FRONTMATTER_FENCE)) {
    throw new Error(`${file}: missing YAML frontmatter`)
  }
  const end = raw.indexOf(`\n${FRONTMATTER_FENCE}`, FRONTMATTER_START)
  if (end === -1) {
    throw new Error(`${file}: unterminated YAML frontmatter`)
  }
  const frontmatter = raw.slice(FRONTMATTER_START, end)
  const content = raw.slice(end + FRONTMATTER_END_OFFSET).replace(/^\r?\n/, "")

  const lines = frontmatter.split(/\r?\n/)
  let name = ""
  let description = ""
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ""
    const keyed = /^([A-Za-z_][A-Za-z0-9_-]*):(.*)$/.exec(line)
    if (!keyed) continue
    const key = keyed[1]
    const rest = (keyed[2] ?? "").trim()

    // Collect the indented continuation lines of a block scalar.
    const blockMatch = /^([>|])([+-]?)$/.exec(rest)
    if (blockMatch) {
      const block: string[] = []
      let cursor = index + 1
      while (cursor < lines.length) {
        const next = lines[cursor] ?? ""
        if (next.trim().length > 0 && !/^\s/.test(next)) break
        block.push(next)
        cursor += 1
      }
      index = cursor - 1
      const value = unfoldBlock(block, blockMatch[1] === "|")
      if (key === "name") name = value
      if (key === "description") description = value
      continue
    }

    if (key !== "name" && key !== "description") continue
    // Strip a matching pair of surrounding quotes without touching inner ones.
    const unquoted = /^(['"])(.*)\1$/.exec(rest)?.[2] ?? rest
    if (key === "name") name = unquoted
    if (key === "description") description = unquoted
  }

  if (!name) throw new Error(`${file}: frontmatter carries no name`)
  if (!description) throw new Error(`${file}: frontmatter carries no description`)
  return { name, description, content }
}

interface ListedSkill {
  readonly name: string
  readonly description: string
  readonly directory: string
  readonly file: string
}

/**
 * Scan `root` for skill directories without loading their bodies.
 *
 * The catalog is fixed at package build time, so scanning once at apply() is
 * enough; bodies stay on disk and are read per `get()`. A missing root yields
 * an empty catalog rather than throwing: a plugin whose skills directory was
 * stripped during packaging must still load its tools.
 */
function scanSkills(root: string): ListedSkill[] {
  let entries: string[]
  try {
    entries = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }

  const listed: ListedSkill[] = []
  for (const entry of entries.sort()) {
    const directory = join(root, entry)
    const file = join(directory, SKILL_FILE)
    let raw: string
    try {
      raw = readFileSync(file, "utf8")
    } catch {
      // A directory without SKILL.md is not a skill; skip it silently so a
      // stray file in the package cannot break the whole catalog.
      continue
    }
    const parsed = parseSkill(raw, file)
    listed.push({
      name: parsed.name,
      description: parsed.description,
      directory,
      file,
    })
  }
  return listed
}

/**
 * Build the DSH skill candidates for every skill bundled under `root`.
 * Exposed for tests and for callers that need the catalog without a provider.
 */
export function listBundledSkills(root: string): SkillCandidate[] {
  return scanSkills(root).map((skill) => ({
    name: skill.name,
    description: skill.description,
    invocation: { modelInvocable: true, userInvocable: true },
    provider: PROVIDER_NAME,
    source: "bundled",
    rank: BUNDLED_SKILL_RANK,
    // 8 of the 12 skills reference references/*.md and templates/*; without a
    // directory base those relative paths have nothing to resolve against.
    resourceBase: { kind: "directory", path: skill.directory },
    locator: skill.file,
  }))
}

/**
 * Load one candidate's body from disk.
 *
 * Separated from the provider literal so the lookup/read/decorate steps sit at the
 * same nesting level instead of inside an object method's promise chain.
 */
async function loadSkill(
  candidate: SkillCandidate,
  options: SkillLookupOptions,
  byName: ReadonlyMap<string, ListedSkill>,
): Promise<SkillDefinition | undefined> {
  // A candidate carries the absolute SKILL.md path it was listed from, so loading
  // works even if the scanned catalog is stale; fall back to the catalog for
  // hand-built candidates in tests.
  const locator = typeof candidate.locator === "string" ? candidate.locator : ""
  const target = locator.length > 0 ? locator : byName.get(candidate.name)?.file
  if (!target) return undefined

  let raw: string
  try {
    raw = await readFile(target, { encoding: "utf8", signal: options.signal })
  } catch {
    // A skill deleted after listing is no longer loadable; the registry treats
    // undefined as "gone" and invalidates its cached entry.
    return undefined
  }
  const parsed = parseSkill(raw, target)
  // Built field by field rather than by spreading and dropping the extras: `rank`
  // and `locator` describe the catalog entry and are not part of a definition, and
  // naming what belongs here keeps that boundary visible.
  return {
    name: candidate.name,
    description: candidate.description,
    invocation: candidate.invocation,
    source: candidate.source,
    provider: candidate.provider,
    path: candidate.path,
    resourceBase: candidate.resourceBase,
    whenToUse: candidate.whenToUse,
    content: parsed.content,
  }
}

/**
 * Create the XP-Gate skill provider for a given skills root.
 *
 * Mirrors the shape of the official `@deepseek-ai/dsh-skill-office` provider:
 * candidates are scanned once, bodies are re-read on every `get()` so editing a
 * skill takes effect without restarting the host.
 */
export function createSkillProvider(root: string): SkillProvider {
  const byName = new Map(scanSkills(root).map((skill) => [skill.name, skill]))
  const candidates = listBundledSkills(root)

  return {
    name: PROVIDER_NAME,
    list: () => Promise.resolve(candidates),
    get: (candidate, options) => loadSkill(candidate, options, byName),
  }
}
