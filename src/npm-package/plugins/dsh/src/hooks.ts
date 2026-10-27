/**
 * DSH-native hooks: the delphi-review guard and the save-time principles check.
 *
 * @test REQ-DSH-015 sprint-phase writes are gated the way the IDE plugin gates them
 * @intent Port the Claude Code guard and save-check to DSH's own pre/post-execute
 *         seams, keeping the degrade rules that made them safe there.
 * @covers AC-DSH-015-01
 *
 * Degrade semantics are copied from plugins/claude-code/bin/delphi-review-guard.sh,
 * which has been in use long enough to have settled them:
 *
 *   no .sprint-state   -> ALLOW  (not a sprint project; gating it would punish every
 *                                 ordinary repo that installed the plugin)
 *   state, no verdict  -> DENY   (sprint is open, review not done)
 *   verdict != APPROVED-> DENY   (reason names the actual verdict)
 *   APPROVED           -> ALLOW
 *
 * The guard only ever inspects state. It must not throw: a throw inside pre-execute
 * aborts the tool call, which is a worse failure than letting an edit through.
 */

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

/** Tools that modify files. Read-only tools are never gated. */
const EDIT_TOOLS: ReadonlySet<string> = new Set(["write", "edit", "str_replace_editor"])

/** Where Sprint Flow records the review verdict. */
const SPRINT_STATE_DIR = ".sprint-state"
const VERDICT_FILE = "delphi-reviewed.json"

/** Denial the guard returns; shape matches DSH's PreToolDecision deny variant. */
export interface GuardDenial {
  readonly kind: "deny"
  readonly reason: string
}

/** The file extensions the principles engine actually covers. */
const CHECKABLE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".go",
  ".java",
  ".kt",
  ".c",
  ".cpp",
  ".h",
  ".swift",
  ".m",
  ".dart",
  ".sh",
  ".ps1",
])

/** Does this tool modify files? */
export function isEditTool(name: string): boolean {
  return EDIT_TOOLS.has(name)
}

/**
 * Should a save-time check run for this path?
 *
 * Documents and data files are excluded on purpose: they are a large share of the
 * commits in repositories using xp-gate, and the engine has nothing to say about
 * them. Skipping them removes most of the hook's cost.
 */
export function isCheckablePath(path: string): boolean {
  const lowered = path.toLowerCase()
  const dot = lowered.lastIndexOf(".")
  if (dot < 0) return false
  return CHECKABLE_EXTENSIONS.has(lowered.slice(dot))
}

/** Read the recorded verdict, or a reason it cannot be read. */
function readVerdict(root: string): { verdict?: string; unreadable?: string } {
  const file = join(root, SPRINT_STATE_DIR, VERDICT_FILE)
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { verdict?: unknown }
    const verdict = typeof parsed.verdict === "string" ? parsed.verdict : ""
    return { verdict }
  } catch (error) {
    // Corrupt JSON is a real state (a half-written file, a merge conflict). Treat it
    // as "not reviewed" and say why, rather than throwing into the tool pipeline.
    return { unreadable: (error as Error).message }
  }
}

/**
 * Decide whether an edit may proceed.
 *
 * Returns undefined to mean "allow" so the caller can `if (denial) return denial`.
 */
export function delphiGuardDecision(root: string, toolName: string): GuardDenial | undefined {
  if (!isEditTool(toolName)) return undefined
  if (!existsSync(join(root, SPRINT_STATE_DIR))) return undefined

  const verdictFile = join(root, SPRINT_STATE_DIR, VERDICT_FILE)
  if (!existsSync(verdictFile)) {
    return {
      kind: "deny",
      reason:
        "delphi-review has not run for this sprint. Complete the Phase 2 delphi-review " +
        "before modifying code, then retry.",
    }
  }

  const { verdict, unreadable } = readVerdict(root)
  if (unreadable !== undefined) {
    return {
      kind: "deny",
      reason: `${VERDICT_FILE} is not readable as JSON (${unreadable}). Re-run delphi-review.`,
    }
  }
  if (verdict !== "APPROVED") {
    return {
      kind: "deny",
      reason:
        `delphi-review verdict is "${verdict || "(missing)"}", not APPROVED. ` +
        "Address the findings and re-run delphi-review, then retry.",
    }
  }
  return undefined
}
