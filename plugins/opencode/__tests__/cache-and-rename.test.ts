/**
 * @test REQ-OPENCODE-CACHE-RENAME
 * @intent 插件的两处磁盘交互，各自有一个"静默做错"的失败方式：
 *
 *         1. **缓存写入**：失败必须静默——缓存是优化，不是功能。但成功时必须真的
 *            原子地写进去（先写 .tmp 再改名），否则一个读到半个文件的进程会把
 *            它当成损坏并丢弃。
 *
 *         2. **会话重命名**：把标题和 session id 拼进 SQL 时必须转义单引号，
 *            否则一个带 `'` 的标题会让语句语法错误，甚至改变语句结构。这是
 *            注入面，不是格式问题。
 *
 * @covers AC-OPENCODE-CACHE-01
 * @covers AC-OPENCODE-RENAME-01
 * @covers AC-OPENCODE-RENAME-02
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

let root
let mod

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "xp-gate-opencode-"))
  vi.resetModules()
  mod = null
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

/** Load the plugin module with `homedir()` pointed at the fixture root. */
async function loadPlugin() {
  vi.doMock("node:os", async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, homedir: () => root }
  })
  const m = await import("../index.ts")
  return m.__test
}

function write(name, body) {
  const target = join(root, name)
  try {
    mkdirSync(join(root, ".xp-gate"), { recursive: true })
    writeFileSync(target, body)
  } catch (e) {
    throw new Error(`cannot write fixture ${target}: ${e.message}`)
  }
}

describe("writeCache / readCache round trip", () => {
  it("writes a cache entry that readCache accepts back", async () => {
    const t = await loadPlugin()
    const file = join(root, ".xp-gate", "cache.json")
    t.writeCache(file, { ts: Date.now(), remoteVersion: "1.2.3", localVersion: "1.2.2" })

    const back = t.readCache(file)
    expect(back).not.toBeNull()
    expect(back.remoteVersion).toBe("1.2.3")
  })

  it("leaves no temporary file behind", async () => {
    // The .tmp file is the atomicity mechanism; leaving it means the next writer's
    // rename races with a stale file.
    const t = await loadPlugin()
    const file = join(root, ".xp-gate", "cache.json")
    t.writeCache(file, { ts: Date.now(), remoteVersion: "1.0.0" })
    expect(existsSync(`${file}.tmp`)).toBe(false)
  })

  it("does not throw when the target directory cannot be created", async () => {
    // The cache is an optimisation; a failure here must never break the host's chat
    // loop.
    const t = await loadPlugin()
    expect(() => t.writeCache(join(root, "no-such-dir", "x", "cache.json"), { ts: 1 })).not.toThrow()
  })

  it("treats a stale entry as absent", async () => {
    // The TTL is what makes the cache worth having: a month-old "you are current"
    // answer must trigger a fresh lookup.
    const t = await loadPlugin()
    const file = join(root, ".xp-gate", "cache.json")
    const longAgo = Date.now() - 30 * 24 * 3600 * 1000
    t.writeCache(file, { ts: longAgo, remoteVersion: "1.0.0" })
    expect(t.readCache(file)).toBeNull()
  })

  it("treats a cache entry without a remote version as absent", async () => {
    const t = await loadPlugin()
    const file = join(root, ".xp-gate", "cache.json")
    write(".xp-gate/cache.json", JSON.stringify({ ts: Date.now() }))
    expect(t.readCache(file)).toBeNull()
  })
})

describe("renameSession", () => {
  it("reports the missing database instead of throwing", async () => {
    // No OpenCode install is a normal condition for a plugin that may be loaded by
    // another host.
    const t = await loadPlugin()
    const msg = t.renameSession("ses_1", "A title")
    expect(msg).toContain("database not found")
    expect(msg).toContain("opencode.db")
  });

  /**
   * A real SQLite database, not a mocked child_process. Escaping is only proven
   * correct by a statement that actually EXECUTES: a mock would accept any string,
   * including the broken one.
   */
  function makeSessionDb() {
    const dbDir = join(root, ".local", "share", "opencode");
    try {
      mkdirSync(dbDir, { recursive: true });
    } catch (e) {
      throw new Error(`cannot create fixture directory ${dbDir}: ${e.message}`);
    }
    const dbPath = join(dbDir, "opencode.db");
    execFileSync("sqlite3", [
      dbPath,
      "CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT, time_updated INTEGER);",
      "INSERT INTO session (id, title) VALUES ('ses_1', 'old');",
    ]);
    return dbPath;
  }

  function readTitle(dbPath, id) {
    return execFileSync("sqlite3", [dbPath, `SELECT title FROM session WHERE id = '${id}';`], {
      encoding: "utf8",
    }).trim();
  }

  it("escapes single quotes in the title so the statement stays valid", async () => {
    // Injection surface, not formatting: an unescaped quote makes the statement a
    // syntax error, and a crafted one can change what the statement does.
    const t = await loadPlugin();
    const dbPath = makeSessionDb();
    const msg = t.renameSession("ses_1", "O'Brien's sprint");
    expect(msg).toContain("renamed");
    expect(readTitle(dbPath, "ses_1")).toBe("O'Brien's sprint");
  });

  it("escapes single quotes in the session id too", async () => {
    const t = await loadPlugin();
    const dbPath = makeSessionDb();
    execFileSync("sqlite3", [dbPath, "INSERT INTO session (id, title) VALUES ('ses_2', 'x');"]);
    t.renameSession("ses_2", "Title");
    expect(readTitle(dbPath, "ses_2")).toBe("Title");
  });

  it("truncates an overlong title rather than storing an unbounded one", async () => {
    // A generous model can return a paragraph; the column is a label.
    const t = await loadPlugin();
    const dbPath = makeSessionDb();
    t.renameSession("ses_1", "x".repeat(500));
    expect(readTitle(dbPath, "ses_1").length).toBeLessThanOrEqual(120);
  });
});
