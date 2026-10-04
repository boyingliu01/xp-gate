import { execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';

interface RuleConfig {
  enabled: boolean;
  threshold?: number;
  exclude?: (string | number)[];
  severity?: string;
  methodThreshold?: number;
}

interface PrinciplesConfig {
  rules: {
    'clean-code': {
      'long-function': RuleConfig;
      'large-file': RuleConfig;
      'god-class': RuleConfig;
      'deep-nesting': RuleConfig;
      'too-many-params': RuleConfig;
      'magic-numbers': RuleConfig;
      'missing-error-handling': RuleConfig;
      'unused-imports': RuleConfig;
      'code-duplication': RuleConfig;
      'many-exports': RuleConfig;
    };
    'solid': {
      'srp': RuleConfig;
      'ocp': RuleConfig;
      'lsp': RuleConfig;
      'isp': RuleConfig;
      'dip': RuleConfig;
    };
  };
  output?: {
    format?: string;
    'show-score'?: boolean;
    colorize?: boolean;
  };
  performance?: {
    mode?: string;
    mediumProjectDefinition?: string;
  };
}

/** Config keys that carry a numeric threshold, per group. */
const NUMERIC_KEYS = ['threshold', 'methodThreshold'] as const;

/** Config keys that must remain arrays. */
const ARRAY_KEYS = ['exclude'] as const;

/** Config keys that must remain non-empty strings. */
const STRING_KEYS = ['severity'] as const;

/**
 * Built-in defaults, hoisted out of `getDefaultConfig()`.
 *
 * Kept as module constants so the factory stays a single return statement and
 * below the deep-nesting threshold (clean-code.deep-nesting), and so the two
 * rule groups are readable side by side.
 */
const DEFAULT_CLEAN_CODE_RULES = {
  'long-function': { enabled: true, threshold: 50, severity: 'warning' },
  'large-file': { enabled: true, threshold: 1150, severity: 'warning' },
  'god-class': { enabled: true, threshold: 15, severity: 'warning' },
  'deep-nesting': { enabled: true, threshold: 4, severity: 'warning' },
  'too-many-params': { enabled: true, threshold: 7, severity: 'info' },
  'magic-numbers': {
    enabled: true,
    exclude: [0, 1, -1, 2, 10, 100, 1000, 60, 24, 7, 30, 365, 256, 1024],
    severity: 'info'
  },
  'missing-error-handling': { enabled: true, severity: 'warning' },
  'unused-imports': { enabled: true, severity: 'info' },
  'code-duplication': { enabled: true, threshold: 15, severity: 'warning' },
  'many-exports': { enabled: true, threshold: 10, severity: 'warning' }
} satisfies PrinciplesConfig['rules']['clean-code'];

const DEFAULT_SOLID_RULES = {
  srp: { enabled: true, methodThreshold: 15, severity: 'warning' },
  ocp: { enabled: true, severity: 'info' },
  lsp: { enabled: true, severity: 'info' },
  isp: { enabled: true, methodThreshold: 10, severity: 'info' },
  dip: {
    enabled: true,
    exclude: ['Date', 'Map', 'Set', 'Error', 'Array', 'Object', 'Promise'],
    severity: 'warning'
  }
} satisfies PrinciplesConfig['rules']['solid'];

/**
 * Deep-clone a rule group so callers cannot mutate the module constants.
 *
 * Without this, `getDefaultConfig()` would hand out references to
 * `DEFAULT_CLEAN_CODE_RULES` / `DEFAULT_SOLID_RULES` and a caller that tweaks
 * one rule (e.g. `config.rules['clean-code']['large-file'].threshold = 10`)
 * would permanently corrupt the defaults for every later caller in the process.
 */
function cloneRules<T extends Record<string, RuleConfig>>(rules: T): T {
  const copy: Record<string, RuleConfig> = {};
  for (const [ruleId, rule] of Object.entries(rules)) {
    copy[ruleId] = {
      ...rule,
      ...(rule.exclude ? { exclude: [...rule.exclude] } : {})
    };
  }
  return copy as T;
}

export function getDefaultConfig(): PrinciplesConfig {
  return {
    rules: {
      'clean-code': cloneRules(DEFAULT_CLEAN_CODE_RULES),
      'solid': cloneRules(DEFAULT_SOLID_RULES)
    },
    output: {
      format: 'console',
      'show-score': true,
      colorize: true
    },
    performance: {
      mode: 'changed-files-only',
      mediumProjectDefinition: '10000 lines / 500 files'
    }
  };
}

/**
 * Load `.principlesrc`, falling back to built-in defaults.
 *
 * Resolution order when `configPath` is omitted:
 *   1. `<git toplevel>/.principlesrc` -- so Gate 4 behaves the same regardless
 *      of the process's cwd.
 *   2. `<cwd>/.principlesrc` -- when git is unavailable (non-repo, broken
 *      shallow checkout, sandboxed CI).
 *
 * A missing, unreadable, or malformed file never throws: the built-in defaults
 * are returned and a warning is printed. Invalid *values* (a string where a
 * number belongs, etc.) keep the default for that key rather than poisoning the
 * rule with a value it cannot compare against.
 */
export async function loadConfig(configPath?: string): Promise<PrinciplesConfig> {
  const defaults = getDefaultConfig();
  const resolvedPath = configPath ? resolve(configPath) : resolveDefaultConfigPath();

  if (!resolvedPath || !existsSync(resolvedPath)) {
    if (configPath) {
      warn(`config file not found: ${resolvedPath} — using built-in defaults`);
    }
    return defaults;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(resolvedPath, 'utf-8'));
  } catch (error) {
    warn(`could not parse ${resolvedPath}: ${describeError(error)} — using built-in defaults`);
    return defaults;
  }

  if (!isPlainObject(parsed)) {
    warn(`${resolvedPath} must contain a JSON object — using built-in defaults`);
    return defaults;
  }

  return mergeConfig(defaults, parsed as Partial<PrinciplesConfig>);
}

/** Resolve the default config path: git toplevel first, then cwd. */
function resolveDefaultConfigPath(): string | null {
  const toplevel = gitToplevel();
  if (toplevel) {
    const candidate = join(toplevel, '.principlesrc');
    if (existsSync(candidate)) return candidate;
  }
  return join(process.cwd(), '.principlesrc');
}

/**
 * `git rev-parse --show-toplevel`, or null when git is unavailable.
 *
 * Deliberately swallows failure: this runs in consumer projects, non-repo
 * directories, and CI sandboxes where git may be absent or the checkout shallow.
 * Callers fall back to cwd.
 */
function gitToplevel(): string | null {
  try {
    const out = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

/** Deep-merge a user config over the defaults, validating each value's shape. */
function mergeConfig(
  defaults: PrinciplesConfig,
  user: Partial<PrinciplesConfig>
): PrinciplesConfig {
  return {
    ...defaults,
    ...user,
    // `rules` needs the group-aware merge below. The other sections are plain
    // option bags, and spreading `...user` alone would let a partial block wipe
    // its sibling defaults -- naming one key under `output` silently discarded
    // `show-score` and `colorize`. Same fail-open shape #457 exists to remove,
    // just outside `rules`; found by the Delphi walkthrough.
    output: mergeSection(defaults.output, user.output),
    performance: mergeSection(defaults.performance, user.performance),
    rules: {
      'clean-code': mergeGroup(
        defaults.rules['clean-code'],
        user.rules?.['clean-code']
      ),
      'solid': mergeGroup(defaults.rules['solid'], user.rules?.['solid'])
    }
  };
}

/** Merge one flat options section, keeping defaults for keys the user omitted. */
function mergeSection<T extends object>(
  defaults: T | undefined,
  user: Partial<T> | undefined
): T | undefined {
  if (!isPlainObject(defaults)) return user as T | undefined;
  if (!isPlainObject(user)) return defaults;
  return { ...defaults, ...user };
}

/**
 * Merge one rule group.
 *
 * Crucially this starts from the defaults for *every* rule in the group, so
 * mentioning only `clean-code` in the file cannot drop the `solid` group.
 * The generic preserves the concrete key set of the group being merged.
 */
function mergeGroup<T extends Record<string, RuleConfig>>(
  defaults: T,
  user: Record<string, Partial<RuleConfig>> | undefined
): T {
  const result = { ...defaults };
  if (!isPlainObject(user)) return result;

  for (const ruleId of Object.keys(defaults)) {
    const override = user[ruleId];
    if (!isPlainObject(override)) continue;
    // Safe: `ruleId` comes from Object.keys(defaults), so it is a key of T.
    (result as Record<string, RuleConfig>)[ruleId] = mergeRule(
      defaults[ruleId],
      override as Partial<RuleConfig>,
      ruleId
    );
  }
  return result;
}

/** Merge one rule, keeping the default for any key whose override is mistyped. */
function mergeRule(
  base: RuleConfig,
  override: Partial<RuleConfig>,
  ruleId: string
): RuleConfig {
  const merged: RuleConfig = { ...base };

  if (typeof override.enabled === 'boolean') {
    merged.enabled = override.enabled;
  } else if (override.enabled !== undefined) {
    warn(`rules.${ruleId}.enabled must be a boolean — keeping default`);
  }

  for (const key of NUMERIC_KEYS) {
    const value = override[key];
    if (value === undefined) continue;
    if (typeof value === 'number' && Number.isFinite(value)) {
      merged[key] = value;
    } else {
      warn(`rules.${ruleId}.${key} must be a finite number — keeping default`);
    }
  }

  for (const key of ARRAY_KEYS) {
    const value = override[key];
    if (value === undefined) continue;
    // Arrays REPLACE rather than concatenate, matching how .principlesrc is
    // written today (an exclude list is the project's complete list).
    if (Array.isArray(value)) {
      merged[key] = [...value] as RuleConfig[typeof key];
    } else {
      warn(`rules.${ruleId}.${key} must be an array — keeping default`);
    }
  }

  for (const key of STRING_KEYS) {
    const value = override[key];
    if (value === undefined) continue;
    if (typeof value === 'string' && value.length > 0) {
      merged[key] = value;
    } else {
      warn(`rules.${ruleId}.${key} must be a non-empty string — keeping default`);
    }
  }

  return merged;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Emit a diagnostic without failing the run (Gate 4 must stay usable). */
function warn(message: string): void {
  process.stderr.write(`⚠️  [principles] ${message}\n`);
}

// ---------------------------------------------------------------------------
// Active configuration
// ---------------------------------------------------------------------------
//
// Rules read their thresholds lazily through `getActiveConfig()` instead of
// snapshotting `getDefaultConfig()` at module load. That snapshot was #457: a
// project's `.principlesrc` was parsed but never consulted, so Gate 4 silently
// enforced the built-in defaults.
//
// CONCURRENCY: this is process-global mutable state. A single process must not
// evaluate two different projects' configs at the same time. Callers that need
// isolation should run them in separate processes. Tests MUST call
// `resetActiveConfig()` between cases to avoid leaking state.
// ---------------------------------------------------------------------------

let activeConfig: PrinciplesConfig = getDefaultConfig();

/** The configuration rules currently enforce. */
export function getActiveConfig(): PrinciplesConfig {
  return activeConfig;
}

/** Install the configuration that rules should enforce. */
export function setActiveConfig(config: PrinciplesConfig): void {
  activeConfig = config;
}

/**
 * Restore the built-in defaults.
 *
 * Exists for test isolation: without it, one test's `setActiveConfig` leaks into
 * the next and produces order-dependent failures.
 */
export function resetActiveConfig(): void {
  activeConfig = getDefaultConfig();
}