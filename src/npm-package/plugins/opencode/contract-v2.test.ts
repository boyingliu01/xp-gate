/**
 * @test REQ-639
 * @intent OpenCode v2（2.1.4+）更换了插件模块契约。v1 的 `{ id, server }` 导出会被
 *         v2 直接拒绝：
 *
 *           PluginModule.LoadError: Plugin must export a default definition with an id
 *           and an effect or setup function.
 *           (SchemaError(Missing key at ["default"]["effect"] / ["default"]["setup"]))
 *
 *         后果不是"少个功能"，是整个插件不加载——`gate-check` / `gate-principles` /
 *         `gate-arch` 在 v2 会话里全部消失，而且每次启动都刷一遍 load error。
 *
 *         这些测试钉的是**契约形状**，不是实现细节：v2 会不会接受这个模块，
 *         取决于 default 导出有没有 `id` 和 `effect`/`setup`。所以断言必须照着
 *         v2 的校验规则写，而不是照着我们的代码写。
 *
 *         同一个 issue 里还有第二个独立的坏点：`exports["./tui"]` 指向
 *         `./tui-plugin.tsx`，而仓库里**根本没有这个文件**。一个指向不存在文件的
 *         导出会让 v2 的 npm 安装器在每次启动时失败——即使 server 侧修好了，
 *         TUI 子路径仍然会把整个安装拖挂。
 * @covers AC-639-01, AC-639-02, AC-639-03
 */
"use strict"

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, "package.json"), "utf8"))

describe("OpenCode v2 模块契约 (#639)", () => {
  /**
   * The v2 validator, reduced to what it actually checks. Reproduced here as a
   * predicate so the test fails with a readable reason instead of a schema dump.
   */
  function v2Accepts(moduleDefault) {
    if (moduleDefault === null || typeof moduleDefault !== "object") {
      return { ok: false, reason: "default export is not an object" }
    }
    if (typeof moduleDefault.id !== "string" || moduleDefault.id === "") {
      return { ok: false, reason: 'missing "id"' }
    }
    const hasEffect = moduleDefault.effect !== undefined
    const hasSetup = typeof moduleDefault.setup === "function"
    if (!hasEffect && !hasSetup) {
      return { ok: false, reason: 'missing "effect" and "setup"' }
    }
    return { ok: true }
  }

  it("AC-639-01: the default export satisfies the v2 schema (id + effect|setup)", () => {
    const source = fs.readFileSync(path.join(PLUGIN_DIR, "index.ts"), "utf8")

    // Read the module shape from source rather than importing: the file is TS and
    // this suite is CommonJS, and the thing under test is the SHAPE, which is
    // visible in source. Importing would drag the whole plugin runtime in.
    const moduleBlock = /const pluginModule\s*=\s*\{([\s\S]*?)\n\}/.exec(source)
    expect(moduleBlock).not.toBeNull()

    const body = moduleBlock[1]
    const hasId = /\bid\s*:/.test(body)
    const hasEffect = /\beffect\s*:/.test(body)
    const hasSetup = /\bsetup\s*:/.test(body)

    // Assert through the validator so a future reader sees WHY, not just which key.
    const verdict = v2Accepts({
      id: hasId ? "xp-gate" : undefined,
      effect: hasEffect ? {} : undefined,
      setup: hasSetup ? () => {} : undefined,
    })
    expect(verdict.reason).toBeUndefined()
    expect(verdict.ok).toBe(true)
  })

  it("AC-639-02: v1 compatibility is kept, not silently dropped", () => {
    const source = fs.readFileSync(path.join(PLUGIN_DIR, "index.ts"), "utf8")
    const moduleBlock = /const pluginModule\s*=\s*\{([\s\S]*?)\n\}/.exec(source)
    expect(moduleBlock).not.toBeNull()

    // v1 reads `server`. Dropping it would break every v1 user on upgrade -- a fix
    // for v2 that breaks v1 is a migration, not a fix, and nobody asked for one.
    expect(moduleBlock[1]).toMatch(/\bserver\s*:/)
  })

  it('AC-639-03: every path in "exports" resolves to a real file', () => {
    const exportsMap = pkg.exports || {}
    const broken = []

    for (const [subpath, entry] of Object.entries(exportsMap)) {
      // Each entry is either a string or { types, import } -- flatten both shapes.
      const targets = typeof entry === "string"
        ? [entry]
        : Object.values(entry || {}).filter((v) => typeof v === "string")

      for (const target of targets) {
        const resolved = path.resolve(PLUGIN_DIR, target)
        if (!fs.existsSync(resolved)) {
          broken.push(`${subpath} -> ${target}`)
        }
      }
    }

    // A dangling export is worse than a missing one: npm accepts the manifest,
    // node resolves the subpath to nothing, and the failure surfaces at the
    // consumer's startup as an install error with no pointer back to this file.
    expect(broken).toEqual([])
  })

  it('AC-639-03: every path in "files" exists too', () => {
    const listed = pkg.files || []
    const missing = listed.filter((entry) => {
      // Directory entries end with "/" and are allowed to match a directory.
      const resolved = path.resolve(PLUGIN_DIR, entry.replace(/\/$/, ""))
      return !fs.existsSync(resolved)
    })
    expect(missing).toEqual([])
  })
})
