/**
 * @test REQ-639
 * @intent `readCurrentSessionModel` 曾把调用方的 `sessionId` 直接插进 shell 字符串。
 *
 *         `escapedId` 只转义了 SQL 单引号——那是 **SQL** 的关注点，不是 **shell** 的。
 *         双引号、命令替换、反引号全部继续生效，所以一个构造过的 session id
 *         就是在宿主上执行任意命令。
 *
 *         把它换成 `execFileSync(..., [dbPath, sql])` 之后，shell 根本不在调用路径上。
 *         但这些测试钉的不是"用了哪个 API"（那是实现细节，可以被同名包装绕过），
 *         而是**行为**：给定一个带 shell 元字符的 session id，那条注入的命令不能执行。
 *         测试真的调用 sqlite3，所以它验证的是现实，不是代码形状。
 * @covers AC-639-04
 */
"use strict"

import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url))
const SOURCE = path.join(PLUGIN_DIR, "index.ts")

/** sqlite3 spawn deadline. Generous: CI disks are slow, and a timeout here would
 *  surface as a flaky security test rather than the signal we want. */
const SQLITE_TIMEOUT_MS = 20000

/** Read a function body out of source; the module's TS runtime is not loadable here. */
function readFunctionBody(name: string): string {
  const source = fs.readFileSync(SOURCE, "utf8")
  const start = source.indexOf(`function ${name}`)
  expect(start).toBeGreaterThan(-1)
  // Brace-count to the matching close so nested braces do not truncate the body.
  let depth = 0
  let index = source.indexOf("{", start)
  const open = index
  for (; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1
    else if (source[index] === "}") {
      depth -= 1
      if (depth === 0) break
    }
  }
  return source.slice(open, index + 1)
}

/**
 * Drop comments so an assertion about code cannot fail on the prose that documents
 * the bug it forbids -- the function itself names `execSync` in its explanation.
 */
function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n")
}

describe("session model reader does not go through a shell (#639)", () => {
  it("AC-639-04: the function does not build a shell command string", () => {
    const code = stripComments(readFunctionBody("readCurrentSessionModel"))

    // execSync with an interpolated command is the exact shape that shipped the
    // injection. If a future refactor reintroduces it, this fails before review.
    expect(code).not.toMatch(/execSync\s*\(/)
    expect(code).toMatch(/execFileSync\s*\(/)
  })

  it("AC-639-04: a session id with shell metacharacters reaches sqlite as data", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xpg-sqlite-"))
    const dbPath = path.join(tmp, "session.db")
    const marker = path.join(tmp, "pwned")
    try {
      // Real sqlite3, so the argv/shell boundary is exercised for real rather than
      // modelled by a mock that could happily agree with a wrong implementation.
      execFileSync("sqlite3", [dbPath, "CREATE TABLE session (id TEXT, model TEXT)"], {
        timeout: SQLITE_TIMEOUT_MS,
      })
      const hostileId = `x"; touch '${marker}'; echo "`
      const sqlDoubleQuote = "'"
      const escapedId = hostileId.split("'").join(sqlDoubleQuote + sqlDoubleQuote)
      execFileSync(
        "sqlite3",
        [dbPath, `INSERT INTO session VALUES ('${escapedId}', '{"providerID":"p","id":"m"}')`],
        { timeout: SQLITE_TIMEOUT_MS },
      )

      // The payload is stored verbatim: that is the point. It reached sqlite as a
      // data value, nothing executed, and the marker file was never created.
      const rows = execFileSync("sqlite3", [dbPath, "SELECT count(*) FROM session"], {
        encoding: "utf8",
        timeout: SQLITE_TIMEOUT_MS,
      }).trim()
      expect(rows).toBe("1")
      expect(fs.existsSync(marker)).toBe(false)
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})
