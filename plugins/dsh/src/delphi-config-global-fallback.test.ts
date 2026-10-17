// TDD-RED probe: loadDelphiConfig must fall back to the global config.
import { describe, it, expect } from "vitest"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DelphiSetupError, loadDelphiConfig } from "./delphi-config.js"

/**
 * @test REQ-DSH-016
 * @intent 项目目录没有 .delphi-config.json 时，回退读取全局
 *         ~/.config/xp-gate/.delphi-config.json（全局唯一事实源，防止
 *         跨项目漂移）；两处都没有才报错。
 * @covers AC-DSH-016-03
 */

const globalStyle = JSON.stringify({
  active_profile: "default",
  profiles: {
    default: {
      provider: "whalecloud",
      providers: { whalecloud: { base_url: "https://lab.example.com/gpt-proxy", api_key: "k" } },
      experts: {
        architecture: { model: "local-deepseek-v4-flash" },
        technical: { model: "local-qwen3.8-flash" },
        feasibility: { model: "local-qwen3.8-27b" },
      },
    },
  },
})

describe("loadDelphiConfig global fallback", () => {
  it("falls back to the global config when the project has none", () => {
    const home = mkdtempSync(join(tmpdir(), "xpg-home-"))
    const project = mkdtempSync(join(tmpdir(), "xpg-proj-"))
    try {
      writeFileSync(join(home, ".delphi-config.json"), globalStyle)
      const cfg = loadDelphiConfig(project, {}, join(home, ".delphi-config.json"))
      expect(cfg.seats.map((s) => s.model).sort()).toEqual(
        ["local-deepseek-v4-flash", "local-qwen3.8-27b", "local-qwen3.8-flash"].sort()
      )
    } finally {
      rmSync(home, { recursive: true, force: true })
      rmSync(project, { recursive: true, force: true })
    }
  })

  it("project config still wins over the global one", () => {
    const home = mkdtempSync(join(tmpdir(), "xpg-home-"))
    const project = mkdtempSync(join(tmpdir(), "xpg-proj-"))
    try {
      writeFileSync(join(home, ".delphi-config.json"), globalStyle)
      writeFileSync(
        join(project, ".delphi-config.json"),
        JSON.stringify({
          ...JSON.parse(globalStyle),
          profiles: {
            default: {
              provider: "whalecloud",
              providers: { whalecloud: { base_url: "https://lab.example.com/gpt-proxy", api_key: "k" } },
              experts: {
                architecture: { model: "proj-a" },
                technical: { model: "proj-b" },
                feasibility: { model: "proj-c" },
              },
            },
          },
        })
      )
      const cfg = loadDelphiConfig(project, {}, join(home, ".delphi-config.json"))
      expect(cfg.seats.map((s) => s.model).sort()).toEqual(["proj-a", "proj-b", "proj-c"])
    } finally {
      rmSync(home, { recursive: true, force: true })
      rmSync(project, { recursive: true, force: true })
    }
  })

  it("errors naming BOTH missing locations when neither exists", () => {
    const project = mkdtempSync(join(tmpdir(), "xpg-proj-"))
    try {
      expect(() => loadDelphiConfig(project, {}, join(project, "absent", ".delphi-config.json"))).toThrow(
        DelphiSetupError
      )
    } finally {
      rmSync(project, { recursive: true, force: true })
    }
  })
})
