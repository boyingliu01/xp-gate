/**
 * @test REQ-DSH-012 delphi-review can produce Gate MW evidence
 * @intent Verify HEAD and branch are read from the repository the review ran in, so
 *         the evidence names the commit the validator will compare against.
 * @covers AC-DSH-012-02
 *
 * Runs against this repository rather than a scratch one: the point is that the
 * values agree with what git itself reports here, which is exactly what the
 * pre-push validator does with them.
 */

import { execFileSync } from "node:child_process"
import { describe, expect, it } from "vitest"
import { readGitContext } from "./git-context.js"

/** Ask git directly, the way the validator does. */
function git(args: readonly string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim()
}

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim()

describe("readGitContext", () => {
  it("reports the same HEAD and branch git reports", () => {
    const context = readGitContext(repoRoot)
    expect(context.head).toBe(git(["rev-parse", "HEAD"]))
    expect(context.branch).toBe(git(["rev-parse", "--abbrev-ref", "HEAD"]))
  })

  it("returns a full 40-character commit id, not an abbreviation", () => {
    // The validator compares commit exactly; an abbreviation would never match.
    expect(readGitContext(repoRoot).head).toMatch(/^[0-9a-f]{40}$/)
  })

  it("fails loudly outside a repository rather than returning blanks", () => {
    // Blank values would produce evidence rejected at push time with no clue why.
    expect(() => readGitContext("/")).toThrow()
  })
})
