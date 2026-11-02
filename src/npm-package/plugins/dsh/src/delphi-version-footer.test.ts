import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { formatPluginFooter, pluginVersion } from "./index.js"

/**
 * @test REQ-709
 * @intent `delphi-review` 的输出里没有任何版本信息，于是"修复没生效"与"修复没做"
 *         无法区分。本 issue 的发现过程就是代价：对一份设计连续评审 4 次全部
 *         只拿到票型、拿不到意见正文，据此判定设计有实质缺陷并两次重写；改用
 *         源码渠道拿到真实意见后，第 2 轮就达成 100% 共识——那 4 次"不通过"
 *         里至少有一部分是我本来就没错，但**无法区分"错"与"没通过"**。
 *
 *         这类缺陷在本仓库已有先例：#451（hook 漂移，doctor --sync-hooks 解决）、
 *         #681（skill 内容漂移）。共同形状是「运行的东西与你以为在运行的东西
 *         不一致，且没有任何机制告诉你」。一行版本号就能消掉一整类排查。
 *
 *         断言必须能失败：如果 footer 里只是硬编码一个字符串，版本升级后它就
 *         开始撒谎——所以测试把它与 package.json 的真实 version 对齐。
 * @covers AC-709-01, AC-709-02
 */

const PKG_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const PKG_VERSION = (JSON.parse(readFileSync(resolve(PKG_ROOT, "package.json"), "utf8")) as { version: string }).version

describe("delphi 输出暴露插件版本 (#709)", () => {
  it("AC-709-01: the version comes from package.json, not a hardcoded literal", () => {
    // If this ever drifts, the footer is lying about which code is running —
    // which is the whole defect this guards against.
    expect(pluginVersion()).toBe(PKG_VERSION)
  })

  it("AC-709-02: the footer names the plugin version so a stale load is visible", () => {
    const footer = formatPluginFooter("whalecloud", "A, B, C")
    expect(footer).toContain(`plugin: ${PKG_VERSION}`)
    // The pre-existing fields must survive: this is an addition, not a rewrite.
    expect(footer).toContain("Provider: whalecloud")
    expect(footer).toContain("Seats: A, B, C")
  })
})
