/**
 * Minimal git context for evidence.
 *
 * @test REQ-DSH-012 delphi-review can produce Gate MW evidence
 * @intent Read HEAD and the current branch name, which the walkthrough evidence must
 *         name exactly, without adding a git library dependency.
 * @covers AC-DSH-012-02
 *
 * Spawned git, not a parsed .git directory: worktrees and detached HEAD have
 * layouts that are easy to misread, and getting either wrong produces evidence the
 * validator rejects at push time with no hint about why.
 */

import { execFileSync } from "node:child_process"

/** The two facts the validator compares against. */
export interface GitContext {
  readonly head: string
  readonly branch: string
}

/**
 * Read HEAD and the branch.
 *
 * The validator compares `branch` to the name the push reports; a detached HEAD
 * reports "HEAD", which is what git itself would say, so it is passed through
 * rather than guessed at.
 */
export function readGitContext(cwd: string): GitContext {
  const run = (args: readonly string[]): string =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()

  try {
    return { head: run(["rev-parse", "HEAD"]), branch: run(["rev-parse", "--abbrev-ref", "HEAD"]) }
  } catch (error) {
    throw new Error(`cannot read git context in ${cwd}: ${(error as Error).message}`)
  }
}
