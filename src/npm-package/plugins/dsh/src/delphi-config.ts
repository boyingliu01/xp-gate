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
import { resolve } from "node:path"
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

/**
 * Expand `${VAR}` and `{env:VAR}` placeholders from the environment.
 * Supports the two spellings already present in xp-gate config files.
 */
export function expandEnv(value: string, env: NodeJS.ProcessEnv = process.env): string {
  return value
    .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_m, name: string) => env[name] ?? "")
    .replace(/\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_m, name: string) => env[name] ?? "")
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
  if (providerNames.size === 0) {
    throw new DelphiSetupError(
      'No provider configured. Set "provider" on the profile or on each expert.',
    )
  }

  const providerTable = profile.providers ?? {}
  const resolvedProviders = new Map<string, { baseUrl: string; apiKey: string }>()
  for (const name of providerNames) {
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
    const apiKey = expandEnv(rawKey, env)
    if (!apiKey) {
      // Name the variable rather than echoing config, which may hold a literal key.
      const varName =
        /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/.exec(rawKey)?.[1] ??
        /\{env:([A-Za-z_][A-Za-z0-9_]*)\}/.exec(rawKey)?.[1]
      throw new DelphiSetupError(
        varName
          ? `API key variable ${varName} is not set in the environment.`
          : `Provider "${name}" has no api_key.`,
      )
    }
    resolvedProviders.set(name, { baseUrl, apiKey })
  }

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

/** Read and resolve `.delphi-config.json` from a project root. */
export function loadDelphiConfig(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedDelphiConfig {
  const path = resolve(cwd, ".delphi-config.json")
  let raw: string
  try {
    raw = readFileSync(path, "utf8")
  } catch {
    throw new DelphiSetupError(`No .delphi-config.json found at ${path}.`)
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
