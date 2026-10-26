import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const PKG_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))

const DSH_PEERS = ["@deepseek-ai/dsh-llm", "@deepseek-ai/dsh-shell", "@deepseek-ai/dsh-tools"] as const

interface PkgShape {
  peerDependencies?: Record<string, string>
}

function readPkg(): PkgShape {
  const path = join(PKG_ROOT, "package.json")
  try {
    return JSON.parse(readFileSync(path, "utf8")) as PkgShape
  } catch (error) {
    throw new Error(`cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Minimal semver comparison for MAJOR.MINOR.PATCH[-PRERELEASE].
 *
 * Deliberately hand-rolled: the plugin ships zero runtime dependencies, and the
 * only thing this test needs is ordinal comparison of a handful of versions.
 * Adding `semver` as a devDependency would let the test pass while telling us
 * nothing about whether DSH's own resolver agrees — the assertion below pins
 * the *contract* (which versions we claim), and the scratch-install check in
 * AC-2 pins the *behaviour* (whether DSH accepts it).
 */
interface Parsed {
  major: number
  minor: number
  patch: number
  pre: string[]
}

function parse(v: string): Parsed {
  const [core, pre = ""] = v.split("-", 2)
  const [major, minor, patch] = core.split(".").map(Number)
  return { major, minor, patch, pre: pre === "" ? [] : pre.split(".") }
}

function cmpPre(a: string[], b: string[]): number {
  // An empty prerelease sorts AFTER any prerelease (1.0.0 > 1.0.0-rc.1).
  if (a.length === 0 && b.length === 0) return 0
  if (a.length === 0) return 1
  if (b.length === 0) return -1
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i]
    const y = b[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const nx = Number(x)
    const ny = Number(y)
    // Number.isNaN on a non-numeric string means "this identifier is alphanumeric".
    const xIsAlpha = Number.isNaN(nx)
    const yIsAlpha = Number.isNaN(ny)
    if (!xIsAlpha && !yIsAlpha) {
      if (nx !== ny) return nx < ny ? -1 : 1
      continue
    }
    // semver: numeric identifiers always sort BELOW alphanumeric ones.
    if (xIsAlpha !== yIsAlpha) return xIsAlpha ? 1 : -1
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

function compare(a: string, b: string): number {
  const x = parse(a)
  const y = parse(b)
  if (x.major !== y.major) return x.major < y.major ? -1 : 1
  if (x.minor !== y.minor) return x.minor < y.minor ? -1 : 1
  if (x.patch !== y.patch) return x.patch < y.patch ? -1 : 1
  return cmpPre(x.pre, y.pre)
}

/**
 * Evaluate the range shapes this package may declare.
 *
 * `^` matters specifically because it was the original (broken) declaration:
 * under 0.x, `^0.1.1-rc.2` allows patch bumps only, so it silently excludes
 * every 0.2.x runtime. Modelling it here keeps that failure expressible as a
 * red assertion instead of a crash.
 */
function satisfiesRange(version: string, range: string): boolean {
  const trimmed = range.trim()

  const bounded = /^>=(\S+)\s+<(\S+)$/.exec(trimmed)
  if (bounded !== null) {
    return compare(version, bounded[1]) >= 0 && compare(version, bounded[2]) < 0
  }

  const caret = /^\^(\S+)$/.exec(trimmed)
  if (caret !== null) {
    const lower = caret[1]
    const { major, minor } = parse(lower)
    if (compare(version, lower) < 0) return false
    // npm caret semantics for 0.x pins the MINOR. Crucially, npm expands
    //   ^0.1.1-rc.2  =>  >=0.1.1-rc.2 <0.2.0-0
    // i.e. caret ALREADY carries the `-0` sentinel, so it excludes every 0.2.x
    // prerelease as well as 0.2.0 itself. That is precisely why the old
    // declaration broke on a 0.2.0-rc.2 runtime, and why the fix must spell out
    // `<0.3.0-0` rather than `<0.3.0` — the same sentinel idiom npm uses itself.
    // (Both facts are pinned against the real `semver` package by the oracle test.)
    const upper = `${major}.${minor + 1}.0-0`
    return compare(version, upper) < 0
  }

  throw new Error(`unsupported range shape: ${range}`)
}

describe("DSH peer compatibility (install gate)", () => {
  /**
   * @test REQ-DSH-017
   * @intent 用真实 semver 校准本文件手写的比较器，避免"测试自己的实现"式假绿。
   *         semver 是仓库根的开发依赖，仅在测试期作为 oracle 使用，
   *         不进入插件运行时依赖（插件 ships zero runtime deps）。
   * @covers AC-DSH-017-04
   */
  it("手写比较器与真实 semver 的判定一致（oracle 校准）", async () => {
    // Resolved through createRequire rather than a static import: `semver` is a
    // devDependency of the repo root, not of this plugin package, and this
    // package ships zero runtime deps. Keeping it dynamic means a missing
    // semver breaks only this oracle test, never the plugin's typecheck.
    const require_ = createRequire(import.meta.url)
    const semver = require_("semver") as {
      satisfies: (v: string, r: string, o?: { includePrerelease?: boolean }) => boolean
    }
    const opts = { includePrerelease: true }
    const versions = ["0.1.0", "0.1.1-rc.2", "0.1.2", "0.2.0-rc.1", "0.2.0-rc.2", "0.2.1", "0.2.9", "0.3.0-rc.1", "0.3.0"]
    const ranges = ["^0.1.1-rc.2", ">=0.2.0-rc.2 <0.3.0-0", ">=0.2.0-rc.2 <0.3.0"]
    for (const range of ranges) {
      for (const version of versions) {
        expect(
          satisfiesRange(version, range),
          `oracle mismatch: ${version} vs ${range} (real semver says ${semver.satisfies(version, range, opts) ? "IN" : "out"})`,
        ).toBe(semver.satisfies(version, range, opts))
      }
    }
  })

  /**
   * @test REQ-DSH-017
   * @intent 验证 peerDependencies 覆盖 DSH 实际运行时版本 0.2.0-rc.2：
   *         旧的 ^0.1.1-rc.2 在 0.x 语义下只放行 patch，导致 dsh plugin add
   *         被 evaluatePluginCompatibility 判定不兼容并回滚安装。
   * @covers AC-DSH-017-01
   */
  it("declares peer ranges that admit the DSH 0.2.x runtime", () => {
    const pkg = readPkg()
    const peers = pkg.peerDependencies ?? {}
    for (const name of DSH_PEERS) {
      const range = peers[name]
      expect(range, `${name} must declare a peer range`).toBeTypeOf("string")
      expect(
        satisfiesRange("0.2.0-rc.2", range as string),
        `${name} range ${range} must admit the running DSH 0.2.0-rc.2`,
      ).toBe(true)
    }
  })

  /**
   * @test REQ-DSH-017
   * @intent 验证上界真正封死 0.3.0 线。DSH 以 includePrerelease 语义比较，
   *         裸 `<0.3.0` 会把 0.3.0-rc.1 放行（预发布排在正式版之前），
   *         因此必须使用 `<0.3.0-0` 哨兵。这是边界值回归，不是风格偏好。
   * @covers AC-DSH-017-02
   */
  it("excludes the whole 0.3.0 line, prereleases included", () => {
    const pkg = readPkg()
    const peers = pkg.peerDependencies ?? {}
    for (const name of DSH_PEERS) {
      const range = peers[name] as string
      expect(satisfiesRange("0.3.0-rc.1", range), `${name}: 0.3.0-rc.1 must be rejected by ${range}`).toBe(false)
      expect(satisfiesRange("0.3.0", range), `${name}: 0.3.0 must be rejected by ${range}`).toBe(false)
    }
  })

  /**
   * @test REQ-DSH-017
   * @intent 验证下界保持为 DSH 0.2.x——0.2.1/0.2.9 这类后续 patch 仍可用，
   *         而 0.1.x 被排除（下界必须如实反映实测过的运行时）。
   * @covers AC-DSH-017-03
   */
  it("admits later 0.2.x patches and rejects 0.1.x", () => {
    const pkg = readPkg()
    const peers = pkg.peerDependencies ?? {}
    for (const name of DSH_PEERS) {
      const range = peers[name] as string
      expect(satisfiesRange("0.2.1", range), `${name}: 0.2.1 must be admitted`).toBe(true)
      expect(satisfiesRange("0.2.9", range), `${name}: 0.2.9 must be admitted`).toBe(true)
      expect(satisfiesRange("0.1.1-rc.2", range), `${name}: 0.1.x must be rejected`).toBe(false)
    }
  })
})
