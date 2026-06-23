/**
 * XP-Gate E2E Upgrade Test
 *
 * End-to-end tests for the OpenCode plugin's auto-upgrade flow:
 *   checkXpGateUpdate → writeUpgradeNotice → chat.message hook
 *
 * These tests validate the FULL code path that was broken before the
 * fire-and-forget fix (commit 9bad3c1):
 *   - spawn must be awaited (not discarded when hook returns)
 *   - cache must be written with status:current after spawn completes
 *   - upgrade-notice.json must be written for TUI display
 *   - runBackgroundUpdates must return the upgrade message
 *
 * All tests use REAL `npm install -g` (skipped in CI).
 *
 * Function implementations are copied from plugins/opencode/index.ts
 * because importing from index.ts requires @opencode-ai/plugin runtime.
 * This mirrors the existing pattern in xp-gate-update.test.ts.
 *
 * @test E2E-001 Full runBackgroundUpdates flow
 * @test E2E-002 Await timing verification
 * @test E2E-003 Upgrade notice file content
 * @test E2E-004 Chat.message hook simulation
 * @test E2E-005 Cache integrity after spawn
 */

import { describe, it, before, after } from "node:test"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir, homedir } from "node:os"
import { execSync, spawn } from "node:child_process"

// ── Constants (must match index.ts) ──

const CACHE_TTL_MS = 86_400_000 // 24h
const FETCH_TIMEOUT_MS = 5_000

const XP_GATE_NPM_PKG = "@boyingliu01/xp-gate"
const XP_GATE_CACHE_FILE = join(homedir(), ".xp-gate", "xp-gate-version-check.json")
const XP_GATE_REGISTRY_URL = `https://registry.npmjs.org/-/package/${encodeURIComponent(XP_GATE_NPM_PKG)}/dist-tags`
const UPGRADE_NOTICE_FILE = join(homedir(), ".xp-gate", "upgrade-notice.json")

// ── Types (must match index.ts) ──

type UpgradeResult = {
  action: "noop" | "upgraded" | "error"
  localVersion: string | null
  remoteVersion: string | null
  error?: string
}

type UpgradeNotice = {
  kind: "upgraded" | "outdated" | "error"
  localVersion: string | null
  remoteVersion: string | null
  message: string
  ts: number
}

type CacheEntry = {
  ts: number
  remoteVersion: string
  localVersion?: string
  status?: string
}

// ── Utilities (must match index.ts) ──

function semverLt(a: string, b: string): boolean {
  const pa = a.replace(/^v/, "").split(".").map(Number)
  const pb = b.replace(/^v/, "").split(".").map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0
    const nb = pb[i] ?? 0
    if (na !== nb) return na < nb
  }
  return false
}

async function fetchNpmLatestVersion(url: string): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) return null
    const data: Record<string, unknown> = await response.json()
    return typeof data.latest === "string" ? data.latest : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function readCache(file: string): CacheEntry | null {
  try {
    if (!existsSync(file)) return null
    const raw = readFileSync(file, "utf8")
    const data = JSON.parse(raw)
    if (Date.now() - data.ts < CACHE_TTL_MS && data.remoteVersion) return data
    return null
  } catch {
    return null
  }
}

function writeCache(file: string, data: object): void {
  try {
    mkdirSync(join(homedir(), ".xp-gate"), { recursive: true })
    writeFileSync(file + ".tmp", JSON.stringify(data), "utf8")
    try { rmSync(file) } catch {}
    writeFileSync(file, readFileSync(file + ".tmp", "utf8"), "utf8")
    try { rmSync(file + ".tmp") } catch {}
  } catch {
    // silent
  }
}

function readXpGateConfig(): { autoUpgrade?: boolean } | null {
  const cfgPath = join(homedir(), ".xp-gate", "config.json")
  try {
    if (!existsSync(cfgPath)) return null
    return JSON.parse(readFileSync(cfgPath, "utf8"))
  } catch {
    return null
  }
}

// ── Local version override (same pattern as xp-gate-update.test.ts) ──

let getLocalVersionOverride: (() => string | null) | null = null

function getLocalXpGateVersion(): string | null {
  if (getLocalVersionOverride) return getLocalVersionOverride()
  try {
    const globalRoot = execSync("npm root -g", { encoding: "utf8" }).trim()
    const pkg = JSON.parse(readFileSync(join(globalRoot, XP_GATE_NPM_PKG, "package.json"), "utf8"))
    return pkg.version || null
  } catch {
    return null
  }
}

// ── Core functions (MUST match index.ts EXACTLY) ──

async function checkXpGateUpdate(): Promise<UpgradeResult> {
  const cached = readCache(XP_GATE_CACHE_FILE)
  const localVersion = getLocalXpGateVersion()

  if (cached?.status === "current" && cached.remoteVersion && localVersion && cached.localVersion === localVersion) {
    return { action: "noop", localVersion, remoteVersion: cached.remoteVersion }
  }

  if (!localVersion) return { action: "noop", localVersion: null, remoteVersion: null }

  const remoteVersion = await fetchNpmLatestVersion(XP_GATE_REGISTRY_URL)
  if (!remoteVersion) return { action: "noop", localVersion, remoteVersion: null }

  if (!semverLt(localVersion, remoteVersion)) {
    writeCache(XP_GATE_CACHE_FILE, { ts: Date.now(), localVersion, remoteVersion, status: "current" })
    return { action: "noop", localVersion, remoteVersion }
  }

  const config = readXpGateConfig()
  if (config?.autoUpgrade === false) {
    writeCache(XP_GATE_CACHE_FILE, { ts: Date.now(), localVersion, remoteVersion, status: "current" })
    return { action: "noop", localVersion, remoteVersion }
  }

  writeCache(XP_GATE_CACHE_FILE, { ts: Date.now(), localVersion, remoteVersion })
  try {
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const child = spawn("npm", ["install", "-g", `${XP_GATE_NPM_PKG}@${remoteVersion}`], {
        stdio: "pipe",
        timeout: 120_000,
      })
      child.on("close", (code) => resolve(code))
      child.on("error", (err) => reject(err))
    })
    if (exitCode === 0) {
      writeCache(XP_GATE_CACHE_FILE, { ts: Date.now(), localVersion: remoteVersion, remoteVersion, status: "current" })
      return { action: "upgraded", localVersion, remoteVersion }
    }
    return { action: "error", localVersion, remoteVersion, error: `npm install exited with code ${exitCode}` }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { action: "error", localVersion, remoteVersion, error: msg }
  }
}

function writeUpgradeNotice(notice: UpgradeNotice): void {
  writeCache(UPGRADE_NOTICE_FILE, notice)
}

/**
 * Full background check — the function called by chat.message hook.
 * MUST match index.ts exactly.
 */
async function runBackgroundUpdates(pluginDir: string): Promise<string | null> {
  void pluginDir // unused in this function, kept for signature match
  const result = await checkXpGateUpdate()
  // checkPluginUpdate is skipped here — it's not part of the xp-gate upgrade flow

  if (result.action === "upgraded") {
    const msg = `[XP-Gate] Auto-upgraded from v${result.localVersion} to v${result.remoteVersion}`
    writeUpgradeNotice({ kind: "upgraded", localVersion: result.localVersion, remoteVersion: result.remoteVersion, message: msg, ts: Date.now() })
    return msg
  }
  if (result.action === "error") {
    const msg = `[XP-Gate] Upgrade check: v${result.remoteVersion} available (auto-upgrade failed: ${result.error})`
    writeUpgradeNotice({ kind: "error", localVersion: result.localVersion, remoteVersion: result.remoteVersion, message: msg, ts: Date.now() })
    return msg
  }
  if (result.remoteVersion && result.localVersion && semverLt(result.localVersion, result.remoteVersion)) {
    const msg = `[XP-Gate] New version v${result.remoteVersion} available (you have v${result.localVersion})`
    writeUpgradeNotice({ kind: "outdated", localVersion: result.localVersion, remoteVersion: result.remoteVersion, message: msg, ts: Date.now() })
    return msg
  }
  return null
}

// ── Helpers ──

function readUpgradeNotice(): UpgradeNotice | null {
  try {
    if (!existsSync(UPGRADE_NOTICE_FILE)) return null
    return JSON.parse(readFileSync(UPGRADE_NOTICE_FILE, "utf8"))
  } catch {
    return null
  }
}

function assertInCI(): boolean {
  if (process.env.CI) {
    console.log("  [SKIP] E2E spawn test disabled in CI (real npm install required)")
    return true
  }
  return false
}

// ═══════════════════════════════════════════════════
//  E2E TESTS
// ═══════════════════════════════════════════════════

// ── Suite 1: Full runBackgroundUpdates E2E ──

void describe("E2E: runBackgroundUpdates → upgrade + notice + cache (E2E-001)", () => {
  const fakeHome = join(tmpdir(), "xp-gate-e2e-001-" + randomUUID())
  const origHome = process.env.HOME

  before(() => {
    process.env.HOME = fakeHome
    mkdirSync(join(fakeHome, ".xp-gate"), { recursive: true })
  })

  after(() => {
    process.env.HOME = origHome
    rmSync(fakeHome, { recursive: true, force: true })
  })

  void it("runBackgroundUpdates returns upgrade message when local < remote", async () => {
    if (assertInCI()) return

    // Seed a stale cache that will force a network check
    const cachePath = join(fakeHome, ".xp-gate", "xp-gate-version-check.json")
    writeFileSync(cachePath, JSON.stringify({
      ts: Date.now() - 86_400_000 - 3600_000, // 25h stale
      localVersion: "0.8.0",
      remoteVersion: "0.8.1",
    }))

    // Override local version to be older than latest on npm
    getLocalVersionOverride = () => "0.8.0"

    const msg = await runBackgroundUpdates("/fake/plugin/dir")
    getLocalVersionOverride = null

    assert.ok(msg !== null, "E2E-001 FAIL: runBackgroundUpdates returned null — expected upgrade message")
    if (msg) {
      assert.ok(msg.includes("Auto-upgraded"), `E2E-001 FAIL: message missing 'Auto-upgraded': ${msg}`)
    }

    // Verify upgrade notice was written
    const notice = readUpgradeNotice()
    assert.ok(notice !== null, "E2E-001 FAIL: upgrade-notice.json was not written")
    if (notice) {
      assert.equal(notice.kind, "upgraded", `E2E-001 FAIL: notice kind=${notice.kind}, expected 'upgraded'`)
      assert.equal(notice.localVersion, "0.8.0")
      assert.ok(notice.remoteVersion !== null)
      assert.ok(notice.message.includes("Auto-upgraded"))
      assert.ok(notice.ts > 0)
    }
  })

  void it("cache is written with status:current immediately after runBackgroundUpdates returns", async () => {
    if (assertInCI()) return

    // Re-seed with stale cache to force another upgrade
    rmSync(join(fakeHome, ".xp-gate", "xp-gate-version-check.json"), { force: true })
    const cachePath = join(fakeHome, ".xp-gate", "xp-gate-version-check.json")
    writeFileSync(cachePath, JSON.stringify({
      ts: Date.now() - 86_400_000 - 3600_000,
      localVersion: "0.8.0",
      remoteVersion: "0.8.1",
    }))

    getLocalVersionOverride = () => "0.8.0"

    await runBackgroundUpdates("/fake/plugin/dir")
    getLocalVersionOverride = null

    // After function returns, cache MUST have status:current
    // This is the KEY assertion — fire-and-forget would fail here
    const finalCache = readCache(XP_GATE_CACHE_FILE)
    if (finalCache) {
      assert.equal(finalCache.status, "current",
        "E2E-001 FAIL: cache status ≠ 'current' after runBackgroundUpdates returned. " +
        "If this fails, the spawn is NOT being awaited — the same bug as before the fix.")
    }
  })
})

// ── Suite 2: Await timing verification ──

void describe("E2E: Await timing — resolve AFTER spawn (E2E-002)", () => {
  const fakeHome = join(tmpdir(), "xp-gate-e2e-002-" + randomUUID())
  const origHome = process.env.HOME

  before(() => {
    process.env.HOME = fakeHome
    mkdirSync(join(fakeHome, ".xp-gate"), { recursive: true })
  })

  after(() => {
    process.env.HOME = origHome
    rmSync(fakeHome, { recursive: true, force: true })
  })

  void it("runBackgroundUpdates resolve time > 1000ms (spawn is awaited)", async () => {
    if (assertInCI()) return

    const cachePath = join(fakeHome, ".xp-gate", "xp-gate-version-check.json")
    writeFileSync(cachePath, JSON.stringify({
      ts: Date.now() - 86_400_000 - 3600_000,
      localVersion: "0.8.0",
      remoteVersion: "0.8.1",
    }))

    getLocalVersionOverride = () => "0.8.0"

    const startTime = Date.now()
    const msg = await runBackgroundUpdates("/fake/plugin/dir")
    const elapsed = Date.now() - startTime
    getLocalVersionOverride = null

    console.log(`  E2E-002: runBackgroundUpdates() returned in ${elapsed}ms`)

    if (msg?.includes("Auto-upgraded")) {
      // Only assert timing if upgrade actually happened (network call succeeded)
      assert.ok(elapsed > 1000,
        `E2E-002 FAIL: runBackgroundUpdates resolved in ${elapsed}ms — ` +
        "spawn was NOT awaited. The chat.message hook would lose the upgrade. " +
        "This is the fire-and-forget bug.")
    } else if (elapsed < 200) {
      // If no upgrade happened (network failure, etc.), elapsed should still be
      // reasonable for a network call (5s timeout for npm registry fetch)
      assert.ok(elapsed > 200,
        `E2E-002 FAIL: resolved in ${elapsed}ms with no upgrade — network check too fast?`)
    }
  })
})

// ── Suite 3: Upgrade notice file verification ──

void describe("E2E: writeUpgradeNotice file content (E2E-003)", () => {
  const fakeHome = join(tmpdir(), "xp-gate-e2e-003-" + randomUUID())
  const origHome = process.env.HOME

  before(() => {
    process.env.HOME = fakeHome
    mkdirSync(join(fakeHome, ".xp-gate"), { recursive: true })
  })

  after(() => {
    process.env.HOME = origHome
    rmSync(fakeHome, { recursive: true, force: true })
  })

  void it("notice file has correct schema (kind, localVersion, remoteVersion, message, ts)", async () => {
    if (assertInCI()) return

    const cachePath = join(fakeHome, ".xp-gate", "xp-gate-version-check.json")
    writeFileSync(cachePath, JSON.stringify({
      ts: Date.now() - 86_400_000 - 3600_000,
      localVersion: "0.8.0",
      remoteVersion: "0.8.1",
    }))

    getLocalVersionOverride = () => "0.8.0"
    await runBackgroundUpdates("/fake/plugin/dir")
    getLocalVersionOverride = null

    const notice = readUpgradeNotice()
    assert.ok(notice !== null, "E2E-003 FAIL: notice file not written")

    if (notice) {
      // Schema validation
      assert.ok(["upgraded", "outdated", "error"].includes(notice.kind),
        `E2E-003 FAIL: invalid kind: ${notice.kind}`)
      assert.ok(typeof notice.localVersion === "string" || notice.localVersion === null,
        "E2E-003 FAIL: localVersion must be string or null")
      assert.ok(typeof notice.remoteVersion === "string" || notice.remoteVersion === null,
        "E2E-003 FAIL: remoteVersion must be string or null")
      assert.ok(typeof notice.message === "string" && notice.message.length > 0,
        "E2E-003 FAIL: message must be non-empty string")
      assert.ok(typeof notice.ts === "number" && notice.ts > 0,
        "E2E-003 FAIL: ts must be positive number")
    }
  })

  void it("notice file can be read back and parsed (no corruption)", async () => {
    if (assertInCI()) return

    // Verify the file is valid JSON (not corrupted by tmpfile write)
    const raw = readFileSync(UPGRADE_NOTICE_FILE, "utf8")
    let parsed: unknown = null
    assert.doesNotThrow(() => {
      parsed = JSON.parse(raw)
    }, "E2E-003 FAIL: notice file contains invalid JSON")
    assert.ok(parsed !== null)
  })
})

// ── Suite 4: Chat.message hook simulation (E2E-004) ──

void describe("E2E: chat.message hook simulation (E2E-004)", () => {
  const fakeHome = join(tmpdir(), "xp-gate-e2e-004-" + randomUUID())
  const origHome = process.env.HOME

  before(() => {
    process.env.HOME = fakeHome
    mkdirSync(join(fakeHome, ".xp-gate"), { recursive: true })
  })

  after(() => {
    process.env.HOME = origHome
    rmSync(fakeHome, { recursive: true, force: true })
  })

  void it("simulated chat.message hook: upgrade completes before hook returns", async () => {
    if (assertInCI()) return

    // This simulates the EXACT code path from index.ts lines 321-327:
    //   "chat.message": async (_input: { message: string }) => {
    //     if (!checked) {
    //       checked = true
    //       const msg = await runBackgroundUpdates(directory).catch(() => null)
    //       if (msg) process.stderr.write(`${msg}\n`)
    //     }
    //   }

    let checked = false
    const stderrOutput: string[] = []

    // Simulate the hook callback (first chat.message invocation)
    const simulateHook = async (pluginDir: string): Promise<void> => {
      if (!checked) {
        checked = true
        const msg = await runBackgroundUpdates(pluginDir).catch(() => null)
        if (msg) stderrOutput.push(msg)
      }
    }

    // Setup: stale cache forces upgrade
    const cachePath = join(fakeHome, ".xp-gate", "xp-gate-version-check.json")
    writeFileSync(cachePath, JSON.stringify({
      ts: Date.now() - 86_400_000 - 3600_000,
      localVersion: "0.8.0",
      remoteVersion: "0.8.1",
    }))

    getLocalVersionOverride = () => "0.8.0"

    const startTime = Date.now()
    await simulateHook("/fake/plugin/dir")
    const elapsed = Date.now() - startTime
    getLocalVersionOverride = null

    console.log(`  E2E-004: simulateHook returned in ${elapsed}ms`)

    // The hook should have upgrade output written to stderr
    assert.ok(stderrOutput.length > 0,
      "E2E-004 FAIL: no stderr output from upgrade — chat.message hook would be silent")

    // If upgrade happened, check the content
    if (stderrOutput.length > 0) {
      const output = stderrOutput.join("\n")
      assert.ok(output.includes("Auto-upgraded") || output.includes("New version"),
        `E2E-004 FAIL: unexpected stderr output: ${output}`)
    }

    // Second hook call should NOT re-run (checked flag)
    const preCount = stderrOutput.length
    await simulateHook("/fake/plugin/dir")
    assert.equal(stderrOutput.length, preCount,
      "E2E-004 FAIL: second hook call re-ran upgrade check (checked flag broken)")

    // After hook returns, cache must be written
    const finalCache = readCache(XP_GATE_CACHE_FILE)
    if (finalCache && stderrOutput.some(s => s.includes("Auto-upgraded"))) {
      assert.equal(finalCache.status, "current",
        "E2E-004 FAIL: after chat.message hook, cache has no status:current. " +
        "The fire-and-forget bug would cause this.")
    }
  })
})

// ── Suite 5: Cache integrity after upgrade (E2E-005) ──

void describe("E2E: Cache integrity after real npm install (E2E-005)", () => {
  const fakeHome = join(tmpdir(), "xp-gate-e2e-005-" + randomUUID())
  const origHome = process.env.HOME

  before(() => {
    process.env.HOME = fakeHome
    mkdirSync(join(fakeHome, ".xp-gate"), { recursive: true })
  })

  after(() => {
    process.env.HOME = origHome
    rmSync(fakeHome, { recursive: true, force: true })
  })

  void it("cache is NOT corrupted after spawn (atomic write via tmpfile)", async () => {
    if (assertInCI()) return

    const cachePath = join(fakeHome, ".xp-gate", "xp-gate-version-check.json")
    writeFileSync(cachePath, JSON.stringify({
      ts: Date.now() - 86_400_000 - 3600_000,
      localVersion: "0.8.0",
      remoteVersion: "0.8.1",
    }))

    getLocalVersionOverride = () => "0.8.0"
    await runBackgroundUpdates("/fake/plugin/dir")
    getLocalVersionOverride = null

    // Cache file must be valid JSON
    const raw = readFileSync(XP_GATE_CACHE_FILE, "utf8")
    let cache: unknown = null
    assert.doesNotThrow(() => {
      cache = JSON.parse(raw)
    }, "E2E-005 FAIL: cache file is not valid JSON — tmpfile write may be corrupted")

    // Cache must have required fields
    const c = cache as Record<string, unknown>
    assert.ok(typeof c.ts === "number", "E2E-005 FAIL: cache missing ts")
    assert.ok(typeof c.remoteVersion === "string", "E2E-005 FAIL: cache missing remoteVersion")
  })
})
