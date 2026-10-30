/**
 * @test REQ-DSH-018 The Delphi model configuration page registers and saves correctly
 * @intent Verify the browser half of the plugin against the contracts DSH actually
 *         enforces: the `window.__ModuleLoader__` bundle shape, the `plugins.row.config`
 *         key, and — most importantly — the settings write op format
 *         `{ op: 'set', path: [...], value }`, which a shipped third-party plugin got
 *         wrong (it sent `{ type, key, value }`, so every save failed silently).
 * @covers AC-DSH-018-01 AC-DSH-018-02 AC-DSH-018-03
 *
 * The bundle is plain CommonJS executed by DSH's own module loader, not by Node, so
 * these tests evaluate it with a minimal `window.__ModuleLoader__` and a stub
 * `require` that stands in for the shared platform modules.
 */

import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const PKG_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))

/** The package name and loader row id the page must key itself by. */
const PKG = "@boyingliu01/dsh-plugin-xp-gate"
const ROW_ID = "tool-xp-gate"

/** What a module loader hands the bundle: the React surface it may rely on. */
function stubRequire(id: string): unknown {
  if (id === "react") {
    return {
      createElement: () => null,
      useState: () => [undefined, () => undefined],
      useEffect: () => undefined,
      useMemo: (fn: () => unknown) => fn(),
      useId: () => "id",
      useRef: (v: unknown) => ({ current: v }),
    }
  }
  if (id === "react/jsx-runtime") return {}
  // Any primitives the page imports must degrade rather than throw.
  return new Proxy({}, { get: () => undefined })
}

/** Evaluate the client bundle and return its exports plus what it registered. */
function loadClient(): {
  exports: Record<string, unknown>
  registrations: Array<{ name: string; options: Record<string, unknown> }>
} {
  const source = readFileSync(join(PKG_ROOT, "lib", "client.js"), "utf8")
  const registrations: Array<{ name: string; options: Record<string, unknown> }> = []
  let loaded: Record<string, unknown> | undefined

  const window = {
    __ModuleLoader__: {
      load: (def: { id: string; factory: (require: typeof stubRequire) => Record<string, unknown> }) => {
        expect(def.id).toBe(PKG)
        loaded = def.factory(stubRequire)
      },
    },
  }

  // The bundle is CommonJS for DSH's own loader, so it cannot be imported; it has
  // to be evaluated. `new Function` is the sandbox here, not a hazard.
  const run = new Function("window", "document", "console", source)
  run(window, { querySelector: () => null, head: { appendChild: () => undefined }, createElement: () => ({ dataset: {}, style: {} }) }, console)

  expect(loaded, "bundle must register through window.__ModuleLoader__.load").toBeDefined()
  return { exports: loaded as Record<string, unknown>, registrations }
}

/** The slot service: records each registration and runs each injected body once. */
function recordingSlots(registrations: Array<{ name: string; options: Record<string, unknown> }>) {
  return {
    register: (options: Record<string, unknown>) => {
      registrations.push({ name: String(options.name), options })
      return () => undefined
    },
    inject: (_name: string, register: () => unknown) => {
      register()
      return () => undefined
    },
    entries: () => [],
    getVersion: () => 0,
    subscribe: () => () => undefined,
  }
}

/** The locale service, answering in English so the assertions can read the text. */
function stubLocale() {
  return {
    register: () => () => undefined,
    bind: () => (key: string) => key,
    getSnapshot: () => ({ active: "en", revision: 0 }),
    subscribe: () => () => undefined,
  }
}

/** The config-forms service: a writable scope that accepts every mutation. */
function stubConfigForms() {
  return {
    get: () => ({ getSnapshot: () => ({}), subscribe: () => () => undefined, mutate: async () => true }),
  }
}

/** A client context recording every slot registration the page makes. */
function makeCtx(registrations: Array<{ name: string; options: Record<string, unknown> }>) {
  return {
    slots: recordingSlots(registrations),
    locale: stubLocale(),
    configForms: stubConfigForms(),
    effect: (fn: () => unknown) => {
      const result = fn()
      if (typeof result === "function") (result as () => void)()
    },
    inject: [] as string[],
  }
}

describe("delphi config client bundle", () => {
  it("declares the services the page needs", () => {
    const { exports } = loadClient()
    expect(exports.apply).toBeTypeOf("function")
    const inject = exports.inject
    expect(Array.isArray(inject), "inject must be an array of service names").toBe(true)
    expect(inject).toContain("slots")
    expect(inject).toContain("configForms")
  })

  it("registers a configuration page under the row the bundle patch declares", () => {
    const { exports, registrations } = loadClient()
    const ctx = makeCtx(registrations)
    ;(exports.apply as (ctx: unknown) => void)(ctx)

    const page = registrations.find((r) => r.name === "plugins.row.config")
    expect(page, "the page must land on plugins.row.config so the row shows Configure").toBeDefined()
    // DSH's config ledger keys a row page by `<package name>#<row id>`.
    expect(page?.options.key).toBe(`${PKG}#${ROW_ID}`)
  })

  it("does not claim plugins.item, which the official settings pages own", () => {
    // A third-party plugin that registered plugins.item displaced nothing but could
    // collide with an official page id; row.config is the supported seat.
    const { exports, registrations } = loadClient()
    ;(exports.apply as (ctx: unknown) => void)(makeCtx(registrations))
    expect(registrations.some((r) => r.name === "plugins.item")).toBe(false)
  })
})

/**
 * The operation shape is the one contract a settings page cannot get wrong
 * silently: DSH's `SettingsPathOpView` is `{ op, path, value }`. The shipped
 * third-party plugin in this very profile sends `{ type, key, value }`, which the
 * Host rejects, so its Save button does nothing. Pin ours.
 */
describe("delphi config save operations", () => {
  /** A filled draft, shaped like the page's internal state. */
  function draft() {
    return {
      seats: [
        { role: "architecture", model: " g-glm-5.3-flash " },
        { role: "technical", model: "g-qwen3.8-flash" },
        { role: "feasibility", model: "g-deepseek-flash" },
      ],
      baseUrl: " https://gw.example/gpt-proxy ",
      apiKey: "${WHALECLOUD_API_KEY}",
      thresholdPercent: "90",
      maxRounds: "5",
    }
  }

  it("emits path-addressed ops, not the {type,key} shape", () => {
    const { exports } = loadClient()
    const ops = (exports.saveOperations as (d: unknown) => Array<Record<string, unknown>>)(draft())
    expect(ops).toHaveLength(1)
    expect(ops[0].op).toBe("set")
    expect(Array.isArray(ops[0].path)).toBe(true)
    expect(ops[0].path).toEqual(["delphi"])
    // Guards against a regression to the broken third-party shape.
    expect(ops[0]).not.toHaveProperty("type")
    expect(ops[0]).not.toHaveProperty("key")
  })

  it("trims model ids and the gateway before writing them", () => {
    const { exports } = loadClient()
    const ops = (exports.saveOperations as (d: unknown) => Array<Record<string, unknown>>)(draft())
    const delphi = ops[0].value as { baseUrl: string; seats: Array<{ model: string }> }
    expect(delphi.baseUrl).toBe("https://gw.example/gpt-proxy")
    expect(delphi.seats.map((s) => s.model)).toEqual([
      "g-glm-5.3-flash",
      "g-qwen3.8-flash",
      "g-deepseek-flash",
    ])
  })

  it("rejects a draft whose seats share a model, matching the host rule", () => {
    const { exports } = loadClient()
    const validate = exports.validationError as (s: unknown, b: string) => string
    const d = draft()
    d.seats[2].model = d.seats[0].model
    expect(validate(d.seats, d.baseUrl)).toBe("duplicate")
  })

  it("rejects a draft with a blank seat or no gateway", () => {
    const { exports } = loadClient()
    const validate = exports.validationError as (s: unknown, b: string) => string
    const blank = draft()
    blank.seats[1].model = "   "
    expect(validate(blank.seats, blank.baseUrl)).toBe("empty")
    const noGateway = draft()
    expect(validate(noGateway.seats, "  ")).toBe("gateway")
  })

  it("accepts a fully specified draft", () => {
    const { exports } = loadClient()
    const validate = exports.validationError as (s: unknown, b: string) => string
    const d = draft()
    expect(validate(d.seats, d.baseUrl)).toBe("")
  })

  it("pads a short stored seat list to the three seats the page edits", () => {
    // A profile that stored one seat must still render three editors, or the user
    // can never reach a valid panel from the page.
    const { exports } = loadClient()
    const seats = (exports.seatsOf as (v: unknown) => Array<{ role: string; model: string }>)({
      seats: [{ role: "architecture", model: "only-one" }],
    })
    expect(seats).toHaveLength(3)
    expect(seats[1].role).toBe("technical")
    expect(seats[2].role).toBe("feasibility")
    expect(seats[1].model).toBe("")
  })
})
