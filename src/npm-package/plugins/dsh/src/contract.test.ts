import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const PKG_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))

interface PkgShape {
  main?: string
  files?: string[]
  scripts?: { prepack?: string }
  publishConfig?: { access?: string }
  dsh?: { bundle?: { patch?: string } }
}

function readPkg(): PkgShape {
  return JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8")) as PkgShape
}

describe("packaging contract", () => {
  /**
   * @test REQ-DSH-001
   * @intent 验证 package.json 声明 dsh.bundle.patch 且 cordis.patch.yml 插入 id=tool-xp-gate + 包名
   * @covers AC-DSH-001-01
   */
  it("declares dsh.bundle.patch and a cordis patch entry", () => {
    expect(readPkg().dsh?.bundle?.patch).toBe("./cordis.patch.yml")
    const patch = readFileSync(join(PKG_ROOT, "cordis.patch.yml"), "utf8")
    expect(patch).toContain("id: tool-xp-gate")
    expect(patch).toContain("@boyingliu01/dsh-plugin-xp-gate")
  })

  /**
   * @test REQ-DSH-010
   * @intent 验证打包契约：main/exports 指向 lib/index.js，files 白名单，prepack 构建，publishConfig.access=public
   * @covers AC-DSH-010-01
   */
  it("satisfies the npm packaging contract", () => {
    const pkg = readPkg()
    expect(pkg.main).toBe("./lib/index.js")
    expect(pkg.files).toContain("lib/")
    expect(pkg.files).toContain("cordis.patch.yml")
    expect(pkg.files).toContain("skills/")
    expect(pkg.scripts?.prepack).toContain("npm run build")
    expect(pkg.publishConfig?.access).toBe("public")
  })

  /**
   * @test REQ-DSH-008
   * @intent 验证 TDD 契约：所有测试文件携带 @test/@intent/@covers 注解，覆盖三工具 + fallback + 取消/超时 + shq 转义
   * @covers AC-DSH-008-01
   */
  it("every test file carries @test/@intent/@covers annotations", () => {
    const files = ["command.test.ts", "gate-runner.test.ts", "index.test.ts", "skills.test.ts"]
    for (const f of files) {
      const content = readFileSync(join(PKG_ROOT, "src", f), "utf8")
      expect(content, `${f}: @test`).toMatch(/@test\s+REQ-\S+/)
      expect(content, `${f}: @intent`).toMatch(/@intent\s+/)
      expect(content, `${f}: @covers`).toMatch(/@covers\s+AC-\S+/)
    }
  })
})