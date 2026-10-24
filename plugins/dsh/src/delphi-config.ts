/**
 * Delphi configuration loading for the DSH plugin.
 *
 * Reads the same `.delphi-config.json` the xp-gate skill already uses, so a
 * project configures its reviewers once and both the skill and the DSH tool
 * agree on who they are.
 *
 * @test REQ-DSH-016
 * @intent 复用项目既有的 .delphi-config.json，把 provider/api_key/专家席位解析成
 *         DSH 工具可用的结构，并对 ${ENV} 占位符与缺失密钥给出可操作的报错。
 * @covers AC-DSH-016-02
 */

import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import type { ExpertSeat, DelphiOptions } from "./delphi.js"
import { validateSeats } from "./delphi.js"

/** Shape of one expert entry in .delphi-config.json. */
interface RawExpert {
  id?: string
  role?: string
  name?: string
  model?: string
  requested_model?: string
  max_tokens?: number
  maxTokens?: number
  /** Per-expert provider override; falls back to the profile default. */
  provider?: string
}

interface RawProfile {
  provider?: string
  providers?: Record<string, { base_url?: string; baseUrl?: string; api_key?: string; apiKey?: string }>
  /**
   * Experts appear in two shapes in the wild: an object keyed by role (what
   * xp-gate actually writes) and an array. Both are accepted.
   */
  experts?: RawExpert[] | Record<string, RawExpert>
  consensus?: { threshold_percent?: number; max_review_rounds?: number }
}

export interface RawDelphiConfig extends RawProfile {
  active_profile?: string
  profiles?: Record<string, RawProfile>
}

export interface ResolvedDelphiConfig {
  readonly seats: ExpertSeat[]
  readonly baseUrl: string
  readonly apiKey: string
  readonly thresholdPercent: number
  readonly maxRounds: number
  readonly provider: string
}

/** Raised when config on disk cannot be turned into a usable review setup. */
export class DelphiSetupError extends Error {}

/** Placeholder spellings xp-gate configs already use. Named so the error text can
 *  quote the exact form the user wrote — a typo in the spelling is
 *  indistinguishable from an unset variable otherwise (#576). */
const PLACEHOLDER_PATTERNS = [
  { form: "shell", re: /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g },
  { form: "env", re: /\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g },
] as const

/**
 * The result of expanding a config value: the expanded text plus what could not
 * be resolved, kept apart by REASON.
 *
 * `missing` and `empty` are different problems with different remedies, so they
 * are separate lists rather than one "did not expand" bucket (#576):
 *   missing — nobody set it: fix the environment (and, on a long-lived host,
 *             restart the process that needs to inherit it)
 *   empty   — someone set it to "": fix the configuration
 */
export interface ExpandedEnv {
  readonly value: string
  readonly missing: readonly string[]
  readonly empty: readonly string[]
}

/**
 * Expand `${VAR}` / `{env:VAR}` without collapsing "unset" into "empty".
 * Supports the two spellings already present in xp-gate config files.
 */
export function expandEnvDetailed(
  value: string,
  env: NodeJS.ProcessEnv = process.env,
): ExpandedEnv {
  const missing: string[] = []
  const empty: string[] = []
  let out = value
  for (const { re } of PLACEHOLDER_PATTERNS) {
    out = out.replace(re, (_m, name: string) => {
      const found = env[name]
      if (found === undefined) {
        if (!missing.includes(name)) missing.push(name)
        return ""
      }
      if (found === "") {
        if (!empty.includes(name)) empty.push(name)
        return ""
      }
      return found
    })
  }
  return { value: out, missing, empty }
}

/**
 * Expand `${VAR}` and `{env:VAR}` placeholders from the environment.
 * Supports the two spellings already present in xp-gate config files.
 *
 * Kept for callers that only need the text; use {@link expandEnvDetailed} when
 * the difference between "unset" and "set to empty" matters.
 */
export function expandEnv(value: string, env: NodeJS.ProcessEnv = process.env): string {
  return expandEnvDetailed(value, env).value
}

/** Pick the active profile, falling back to the top level. */
function selectProfile(cfg: RawDelphiConfig): RawProfile {
  const active = cfg.active_profile
  if (active && cfg.profiles?.[active]) return cfg.profiles[active]
  if (cfg.profiles && Object.keys(cfg.profiles).length > 0) {
    throw new DelphiSetupError(
      `No active_profile set. Available: ${Object.keys(cfg.profiles).join(", ")}`,
    )
  }
  return cfg
}

function seatFromRaw(raw: RawExpert, index: number, fallbackRole: string): ExpertSeat {
  const model = raw.model ?? raw.requested_model ?? ""
  return {
    id: raw.id ?? raw.name ?? `Expert ${String.fromCharCode(65 + index)}`,
    role: raw.role ?? fallbackRole,
    model,
    maxTokens: raw.max_tokens ?? raw.maxTokens,
  }
}

/** Normalize either experts shape into an ordered list with roles attached. */
function normalizeExperts(experts: RawProfile["experts"]): Array<{ raw: RawExpert; role: string }> {
  if (!experts) return []
  if (Array.isArray(experts)) {
    return experts.map((raw, i) => ({ raw, role: raw.role ?? `expert${i}` }))
  }
  // Object form: the KEY is the role, which is how xp-gate writes it.
  return Object.entries(experts).map(([role, raw]) => ({ raw, role }))
}

/** Resolve every referenced provider's base_url + api_key, failing loudly. */
function resolveProviders(
  profile: RawProfile,
  needed: Set<string>,
  env: NodeJS.ProcessEnv,
): Map<string, { baseUrl: string; apiKey: string }> {
  if (needed.size === 0) {
    throw new DelphiSetupError('No provider configured. Set "provider" on the profile or on each expert.')
  }
  const providerTable = profile.providers ?? {}
  const resolved = new Map<string, { baseUrl: string; apiKey: string }>()
  for (const name of needed) {
    const entry = providerTable[name]
    if (!entry) {
      throw new DelphiSetupError(
        `Provider "${name}" is not defined under "providers". ` +
          `Known: ${Object.keys(providerTable).join(", ") || "(none)"}`,
      )
    }
    const baseUrl = entry.base_url ?? entry.baseUrl ?? ""
    if (!baseUrl) throw new DelphiSetupError(`Provider "${name}" has no base_url.`)

    const rawKey = entry.api_key ?? entry.apiKey ?? ""
    // Find the placeholder BEFORE touching `env`: the spelling lives in the
    // config, not the environment, so a broken `env` must not hide it.
    const placeholder = findPlaceholder(rawKey)
    // Every read of `env` may fail — a caller can pass a proxy, a frozen object,
    // or an environment that throws on access. Diagnostics must never become the
    // reason the run dies: on any error fall back to the plainest possible
    // message, which is still a DelphiSetupError (#576).
    let expanded: ExpandedEnv
    try {
      expanded = expandEnvDetailed(rawKey, env)
    } catch {
      expanded = { value: "", missing: placeholder ? [placeholder.name] : [], empty: [] }
    }
    const apiKey = expanded.value
    if (!apiKey) {
      // Name the variable rather than echoing config, which may hold a literal key.
      throw new DelphiSetupError(
        placeholder
          ? describeUnusableKey(name, rawKey, placeholder, expanded, env)
          : `Provider "${name}" has no api_key.`,
      )
    }
    resolved.set(name, { baseUrl, apiKey })
  }
  return resolved
}

/** Locate the first placeholder in a config value, keeping both name and spelling. */
function findPlaceholder(rawKey: string): { name: string; spelling: string } | null {
  for (const { re } of PLACEHOLDER_PATTERNS) {
    // Fresh lastIndex each call: the shared regexes are global.
    re.lastIndex = 0
    const match = re.exec(rawKey)
    if (match) return { name: match[1], spelling: match[0] }
  }
  return null
}

/** Env keys whose name matches case-insensitively. Never throws: a hostile or
 *  partially-broken `env` must not turn diagnostics into the failure (#576). */
function caseVariantsOf(name: string, env: NodeJS.ProcessEnv): string[] {
  try {
    const lower = name.toLowerCase()
    return Object.keys(env).filter((k) => k !== name && k.toLowerCase() === lower)
  } catch {
    return []
  }
}

/**
 * Build the message for a provider whose api_key did not expand to anything.
 *
 * The old text asserted "is not set in the environment" for every failure. That
 * is a factual claim the caller cannot make from an expanded string alone: an
 * empty result also happens when the variable IS set — to "", or set in a
 * place this process never inherited (a long-lived host whose parent started
 * before the variable was written; a shell that never reloaded; a systemd unit
 * without restart; a container created without `-e`). The reader was sent to
 * check the key, the config, and the gateway — everything except the parent
 * process environment (#576).
 */
function describeUnusableKey(
  providerName: string,
  rawKey: string,
  placeholder: { name: string; spelling: string },
  expanded: ExpandedEnv,
  env: NodeJS.ProcessEnv,
): string {
  const { name, spelling } = placeholder
  const lines: string[] = []

  if (expanded.empty.includes(name)) {
    lines.push(
      `API key variable ${name} is empty in the environment.`,
      `Provider "${providerName}" uses ${spelling} in its api_key.`,
      "The variable is defined but has no value — this is usually a configuration error.",
      `Set ${name} to a non-empty value.`,
    )
  } else {
    lines.push(
      `API key variable ${name} is not set in the environment.`,
      `Provider "${providerName}" uses ${spelling} in its api_key.`,
    )
    const variants = caseVariantsOf(name, env)
    if (variants.length > 0) {
      lines.push(
        `Note: the environment has a variable whose name differs only in case: ` +
          `${variants.join(", ")}. Environment variable names are case-sensitive on ` +
          "POSIX systems, so ${name} does not match it.",
      )
    }
    lines.push(
      `Set ${name} and restart the process that reads it. If you already set it, ` +
        "a long-running parent may still be holding the environment it started " +
        "with — the variable is inherited once at process start and not refreshed.",
    )
  }

  if (!rawKey.includes("${") && !rawKey.includes("{env:")) {
    // Reached only when the value expanded to "" from a literal; say so instead
    // of naming a variable that is not referenced.
    lines.push(`The configured api_key is a literal value and expands to an empty string.`)
  }
  return lines.join(" ")
}

/**
 * Turn raw config into a ready-to-run review setup.
 * Fails loudly and specifically: a missing key or an unexpanded placeholder is
 * the most common way a Delphi run silently degrades.
 */
export function resolveConfig(
  cfg: RawDelphiConfig,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedDelphiConfig {
  const profile = selectProfile(cfg)
  const normalized = normalizeExperts(profile.experts)

  // An expert may name its own provider; otherwise there must be a profile-wide
  // default. Resolve base_url/api_key per provider so mixed setups work.
  const providerNames = new Set(
    normalized.map((e) => e.raw.provider ?? profile.provider).filter((p): p is string => !!p),
  )
  const resolvedProviders = resolveProviders(profile, providerNames, env)

  const seats = normalized.map((e, i) => seatFromRaw(e.raw, i, e.role))
  // Surface an unexpanded placeholder as a config error, not a provider 404.
  for (const s of seats) {
    if (s.model.includes("${") || s.model.includes("{env:")) {
      throw new DelphiSetupError(
        `Expert "${s.id}" model "${s.model}" is an unexpanded placeholder.`,
      )
    }
  }
  validateSeats(seats)

  return buildResult(profile, normalized, resolvedProviders, seats, cfg)
}

/** Assemble the final result after seats and providers validated. */
function buildResult(
  profile: RawProfile,
  normalized: Array<{ raw: RawExpert; role: string }>,
  resolvedProviders: Map<string, { baseUrl: string; apiKey: string }>,
  seats: ExpertSeat[],
  cfg: RawDelphiConfig,
): ResolvedDelphiConfig {
  // All seats share one gateway in the supported setup; require agreement so a
  // mixed list cannot silently send one seat's key to another host.
  const chosen = resolvedProviders.get(normalized[0].raw.provider ?? profile.provider ?? "")
  if (!chosen) throw new DelphiSetupError("Unable to resolve a provider for the first expert.")
  for (const e of normalized) {
    const name = e.raw.provider ?? profile.provider ?? ""
    const other = resolvedProviders.get(name)
    if (!other || other.baseUrl !== chosen.baseUrl) {
      throw new DelphiSetupError(
        `All experts must share one gateway base_url; "${name}" differs. ` +
          `Split the review or align the providers.`,
      )
    }
  }

  // consensus may sit on the profile or at the document root; both occur.
  const consensus = profile.consensus ?? cfg.consensus

  return {
    seats,
    baseUrl: chosen.baseUrl,
    apiKey: chosen.apiKey,
    thresholdPercent: consensus?.threshold_percent ?? 90,
    maxRounds: consensus?.max_review_rounds ?? 5,
    provider: normalized[0].raw.provider ?? profile.provider ?? "",
  }
}

/** Default global config location; XDG_CONFIG_HOME is an accepted override. */
function defaultGlobalConfigPath(env: NodeJS.ProcessEnv): string {
  // r16 MA-01 disposition: the CLI lib pins ~/.config/xp-gate, and on Linux
  // $HOME/.config IS the XDG default — opt-in escape hatch only.
  return join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "xp-gate", ".delphi-config.json")
}

/** Read and resolve `.delphi-config.json` from a project root. */
export function loadDelphiConfig(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
  globalPath: string = defaultGlobalConfigPath(env),
): ResolvedDelphiConfig {
  // Global fallback (AC-DSH-016-03): the machine-wide config at
  // ~/.config/xp-gate/.delphi-config.json is the single source of truth for
  // every project. Without it, each repo needed its own copy — and reading a
  // stale or differently-priced config from another project's directory caused
  // real money loss (2026-10-03: an expensive overseas model burned the daily
  // quota). A project-local config still wins, so per-project overrides work.
  const path = resolve(cwd, ".delphi-config.json")
  let raw: string
  try {
    raw = readFileSync(path, "utf8")
  } catch (projectError) {
    // Fall back ONLY when the project file is genuinely absent (ENOENT); any
    // other read error must surface rather than silently route this run to
    // another config. Same semantics as delphi-external-review.cjs, which
    // gates the fallback on existsSync (walkthrough R8 MA-01).
    if ((projectError as NodeJS.ErrnoException)?.code !== "ENOENT") {
      throw new DelphiSetupError(`Cannot read ${path}: ${(projectError as Error).message}`)
    }
    try {
      raw = readFileSync(globalPath, "utf8")
    } catch (globalError) {
      // r16 CI-01: mirror the project-read semantics — a global file that is
      // absent means "no config anywhere"; any OTHER error (EACCES/EISDIR)
      // must surface as-is rather than masquerade as a missing file.
      if ((globalError as NodeJS.ErrnoException)?.code !== "ENOENT") {
        throw new DelphiSetupError(`Cannot read ${globalPath}: ${(globalError as Error).message}`)
      }
      throw new DelphiSetupError(
        `No .delphi-config.json found at ${path} or the global location ${globalPath}.`
      )
    }
  }
  let parsed: RawDelphiConfig
  try {
    parsed = JSON.parse(raw) as RawDelphiConfig
  } catch (e) {
    throw new DelphiSetupError(`.delphi-config.json is not valid JSON: ${(e as Error).message}`)
  }
  return resolveConfig(parsed, env)
}

/** Build the transport options a round needs from a resolved config. */
export function toDelphiOptions(cfg: ResolvedDelphiConfig): DelphiOptions {
  return {
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey,
    seats: cfg.seats,
    thresholdPercent: cfg.thresholdPercent,
    maxRounds: cfg.maxRounds,
  }
}
