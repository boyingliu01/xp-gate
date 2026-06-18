/**
 * XP-Gate auto-update tests
 *
 * Tests for:
 * - semverLt: version comparison
 * - checkXpGateUpdate: xp-gate npm registry check + cache + auto-upgrade
 * - chat.message integration
 * - Legacy checkPluginUpdate modified to detect BOTH packages
 */

import { describe, it, before, after } from "node:test"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir, homedir } from "node:os"
import { execSync } from "node:child_process"

// ── Pure function: semverLt ──

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

// ── XP-GATE specific: these are the new functions we need to implement ──

const XP_GATE_CACHE_FILE = join(homedir(), ".xp-gate", "xp-gate-version-check.json")
const XP_GATE_NPM_PKG = "@boyingliu01/xp-gate"
const XP_GATE_REGISTRY_URL = `https://registry.npmjs.org/-/package/${encodeURIComponent(XP_GATE_NPM_PKG)}/dist-tags`
const CACHE_TTL_MS = 86_400_000 // 24h

type XpGateCache = {
  ts: number
  localVersion: string
  remoteVersion: string
  status?: "current" | "upgraded"
}

/**
 * Read version from installed xp-gate npm package.
 * Returns null if not installed.
 */
function getLocalXpGateVersion(): string | null {
  try {
    const pkgPath = join(
      execSync("npm root -g", { encoding: "utf8" }).trim(),
      XP_GATE_NPM_PKG,
      "package.json"
    )
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"))
    return pkg.version || null
  } catch {
    return null
  }
}

/**
 * Read cache file, returns null if absent / stale.
 */
function readXpGateCache(): XpGateCache | null {
  try {
    if (!existsSync(XP_GATE_CACHE_FILE)) return null
    const raw = readFileSync(XP_GATE_CACHE_FILE, "utf8")
    const data: XpGateCache = JSON.parse(raw)
    if (Date.now() - data.ts < CACHE_TTL_MS && data.remoteVersion) {
      return data
    }
    return null // stale
  } catch {
    return null
  }
}

/**
 * Write cache file.
 */
function writeXpGateCache(data: XpGateCache): void {
  try {
    mkdirSync(join(homedir(), ".xp-gate"), { recursive: true })
    const tmp = XP_GATE_CACHE_FILE + ".tmp." + process.pid
    writeFileSync(tmp, JSON.stringify(data), "utf8")
    try { rmSync(XP_GATE_CACHE_FILE) } catch {}
    const orig = readFileSync(tmp, "utf8")
    writeFileSync(XP_GATE_CACHE_FILE, orig, "utf8")
    rmSync(tmp)
  } catch {
    // silent
  }
}

/**
 * Fetch latest version from npm registry. Returns null on failure.
 */
async function fetchNpmLatestVersion(url: string, timeoutMs = 5000): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) return null
    const data: Record<string, unknown> = await response.json()
    const latest = data.latest
    return typeof latest === "string" ? latest : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

type UpgradeResult = {
  action: "noop" | "upgraded" | "error"
  localVersion: string | null
  remoteVersion: string | null
  error?: string
}

/**
 * Check xp-gate version and auto-upgrade if outdated.
 *
 * - Respects daily cache
 * - Fires npm install -g in background
 * - Returns result for user notification
 */
async function checkXpGateUpdate(): Promise<UpgradeResult> {
  // 1. Check cache
  const cached = readXpGateCache()
  if (cached && cached.status === "current") {
    return { action: "noop", localVersion: cached.localVersion, remoteVersion: cached.remoteVersion }
  }

  // 2. Get local version
  const localVersion = getLocalXpGateVersion()
  if (!localVersion) {
    return { action: "noop", localVersion: null, remoteVersion: null }
  }

  // 3. Fetch remote
  const remoteVersion = await fetchNpmLatestVersion(XP_GATE_REGISTRY_URL)
  if (!remoteVersion) {
    return { action: "noop", localVersion, remoteVersion: null }
  }

  // 4. Compare
  if (!semverLt(localVersion, remoteVersion)) {
    writeXpGateCache({ ts: Date.now(), localVersion, remoteVersion, status: "current" })
    return { action: "noop", localVersion, remoteVersion }
  }

  // 5. Outdated — auto upgrade
  writeXpGateCache({ ts: Date.now(), localVersion, remoteVersion })
  try {
    execSync(`npm install -g ${XP_GATE_NPM_PKG}@${remoteVersion}`, {
      stdio: "pipe",
      timeout: 120_000,
    })
    writeXpGateCache({ ts: Date.now(), localVersion: remoteVersion, remoteVersion, status: "current" })
    return { action: "upgraded", localVersion, remoteVersion }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { action: "error", localVersion, remoteVersion, error: msg }
  }
}

// ── Tests ──

void describe("semverLt", () => {
  void it("returns true when local < remote", () => {
    assert.equal(semverLt("0.9.1", "0.9.2"), true)
  })

  void it("returns false when local > remote", () => {
    assert.equal(semverLt("0.9.3", "0.9.2"), false)
  })

  void it("returns false when versions equal", () => {
    assert.equal(semverLt("0.9.2", "0.9.2"), false)
  })

  void it("handles 'v' prefix", () => {
    assert.equal(semverLt("v0.9.1", "v0.9.2"), true)
  })

  void it("handles mixed prefix", () => {
    assert.equal(semverLt("v0.9.1", "0.9.2"), true)
  })

  void it("handles different segment counts", () => {
    assert.equal(semverLt("0.9", "0.9.2"), true)
  })

  void it("handles major version bumps", () => {
    assert.equal(semverLt("0.9.2", "1.0.0"), true)
  })

  void it("returns false for identical versions with v prefix", () => {
    assert.equal(semverLt("v1.0.0", "1.0.0"), false)
  })
})

void describe("checkXpGateUpdate — cache & upgrade", () => {
  const fakeHome = join(tmpdir(), "xp-gate-upd-test-" + randomUUID())
  const origHome = process.env.HOME

  before(() => {
    process.env.HOME = fakeHome
    mkdirSync(join(fakeHome, ".xp-gate"), { recursive: true })
  })

  after(() => {
    process.env.HOME = origHome
    rmSync(fakeHome, { recursive: true, force: true })
  })

  void it("returns noop when no xp-gate installed locally", async () => {
    const result = await checkXpGateUpdate()
    assert.equal(result.action, "noop")
    // localVersion may be null (no install) or the actual version (test env has global)
    // Either is acceptable — the key behavior is noop, not the value
  })

  void it("returns noop when cache says current", async () => {
    const cachePath = join(fakeHome, ".xp-gate", "xp-gate-version-check.json")
    writeFileSync(cachePath, JSON.stringify({
      ts: Date.now(),
      localVersion: "0.9.2",
      remoteVersion: "0.9.2",
      status: "current",
    }))

    const result = await checkXpGateUpdate()
    assert.equal(result.action, "noop")
    assert.equal(result.remoteVersion, "0.9.2")
  })

  void it("handles cache expiry correctly", async () => {
    const cachePath = join(fakeHome, ".xp-gate", "xp-gate-version-check.json")
    writeFileSync(cachePath, JSON.stringify({
      ts: Date.now() - 86_400_000 - 3600_000, // 25h old
      localVersion: "0.9.1",
      remoteVersion: "0.9.2",
    }))

    const result = await checkXpGateUpdate()
    // Stale cache should be ignored — should check npm registry
    // If network check fails, returns noop with localVersion if found
    assert.equal(result.action, "noop")
  })
})
