import { execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';

export interface RuleConfig {
  enabled: boolean;
  threshold?: number;
  exclude?: (string | number)[];
  severity?: string;
  methodThreshold?: number;
}

/**
 * A path-scoped severity relaxation (#806).
 *
 * `severity` in `rules` is one global value per rule, so a project could not both
 * block a rule in production and keep it advisory in tests. Measured here with
 * four rules promoted to `error`: 220 of 271 findings were in test files, so
 * enabling production blocking would have blocked nearly every test edit -- and
 * demoting the rule globally re-opened the defect the promotion existed to fix.
 *
 * These entries may only RELAX a rule (error -> warning/info). They never
 * promote and never suppress: the violation is still reported, only its severity
 * changes for matching paths. See `resolveSeverityForFile`.
 */
export interface SeverityOverride {
  // POSIX-style globs matched against the file path, e.g. any `__tests__`
  // directory at any depth. Written as a line comment on purpose: a block
  // comment cannot carry a globstar path, because the `/` after `**` closes it.
  paths: string[];
  /** `"<group>.<rule>"` -> target severity. */
  rules: Record<string, string>;
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
    // Architecture (ARCH-07 / ARCH-12, #694 / #699). A separate group rather
    // than more `clean-code` entries: these rules constrain package layout and
    // dependency direction, which is neither a Clean Code smell nor a SOLID
    // principle. Filing them under `clean-code` would give users the
    // self-contradictory key `clean-code.arch-naming` to configure.
    'arch': {
      'controller': RuleConfig;
      'service': RuleConfig;
      'repository': RuleConfig;
      'dto-layering': RuleConfig;
      'domain-event': RuleConfig;
      'util-service': RuleConfig;
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
  /** Path-scoped severity relaxations, applied in order (#806). */
  overrides?: SeverityOverride[];
}

/** Config keys that carry a numeric threshold, per group. */
const NUMERIC_KEYS = ['threshold', 'methodThreshold'] as const;

/**
 * Ceiling on any single git call made while resolving config. This runs inside a
 * pre-commit hook, so an unbounded wait is not a slow commit but a hung one.
 */
const GIT_TIMEOUT_MS = 15_000;

/** Config keys that must remain arrays. */
const ARRAY_KEYS = ['exclude'] as const;

/**
 * `severity` is not a free-form string: `summary.errorCount` and Gate 4's report
 * grep both match the exact lowercase literal `error`, so anything else -- "Error",
 * "fatal" -- runs the rule, reports the violation, and blocks nothing. Validated
 * against the vocabulary rather than treated as an opaque string.
 */
const SEVERITIES = ['error', 'warning', 'info'] as const;

/** Config keys whose value must be one of a fixed set, with that set. */
const ENUM_KEYS = { severity: SEVERITIES } as const;

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
 * Architecture rule defaults (#694 / #699).
 *
 * All six are `error` except `util-service`, which is `warning` by design:
 * a helper depending on a service is a smell worth surfacing, but blocking a
 * commit on it would fail builds over code that works (AC-699-08, AC-699-10,
 * AC-699-11).
 */
const DEFAULT_ARCH_RULES = {
  controller: { enabled: true, severity: 'error' },
  service: { enabled: true, severity: 'error' },
  repository: { enabled: true, severity: 'error' },
  'dto-layering': { enabled: true, severity: 'error' },
  'domain-event': { enabled: true, severity: 'error' },
  'util-service': { enabled: true, severity: 'warning' }
} satisfies PrinciplesConfig['rules']['arch'];

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
      'solid': cloneRules(DEFAULT_SOLID_RULES),
      'arch': cloneRules(DEFAULT_ARCH_RULES)
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
 *
 * One exception, for a path the CALLER named: if `configPath` is passed and that
 * file does not exist, loading fails. "The project has no `.principlesrc`" is a
 * normal state, but "the project declared one and it cannot be found" is a
 * misconfiguration, and answering it with built-in thresholds re-creates exactly
 * the fail-open gate this module exists to close (#457, walkthrough FC-08).
 */
/**
 * The config path to read, or null when the built-in defaults apply.
 *
 * An EXPLICIT path that does not exist THROWS: the caller named a file, and silently
 * using defaults would hide a typo behind a passing gate. A default path that does not
 * exist is simply "no config", which is the normal case for a new project.
 */
function locateConfig(configPath?: string): string | null {
  const resolvedPath = configPath ? resolve(configPath) : resolveDefaultConfigPath();
  if (isReadable(resolvedPath)) return resolvedPath as string;
  if (configPath) throw new Error(`config file not found: ${resolvedPath}`);
  return null;
}

/** Whether this path names a config file that exists. */
function isReadable(resolvedPath: string | null): boolean {
  return Boolean(resolvedPath) && existsSync(resolvedPath as string);
}

export async function loadConfig(configPath?: string): Promise<PrinciplesConfig> {
  const defaults = getDefaultConfig();
  const resolvedPath = locateConfig(configPath);
  if (!resolvedPath) return defaults;

  const parsed = readConfigObject(resolvedPath);
  return parsed ? mergeConfig(defaults, parsed) : defaults;
}

/**
 * The config object at this path, or null when it is unusable.
 *
 * An EXPLICIT path that fails is still a warning, not a throw: the caller asked for a
 * config, got an unusable one, and the built-in defaults are a working answer -- while an
 * exception here would take down every rule that reads a config.
 */
function readConfigObject(resolvedPath: string): Partial<PrinciplesConfig> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(resolvedPath, 'utf-8'));
  } catch (error) {
    warn(`could not parse ${resolvedPath}: ${describeError(error)} — using built-in defaults`);
    return null;
  }
  if (isPlainObject(parsed)) return parsed as Partial<PrinciplesConfig>;
  // A `.principlesrc` holding an array or a string is a shape error, not a parse error.
  warn(`${resolvedPath} must contain a JSON object — using built-in defaults`);
  return null;
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
      // Bounded like every other git call that runs inside a hook. Without it a
      // wedged git (locked index, stalled credential prompt, network-backed fs) hangs
      // the commit -- and this path is taken by every Gate 4 run, since gate-4.sh
      // passes no --config. Raised by the Delphi walkthrough (MAJ-01), which noticed
      // the timeout added to baseline-prune.ts had not been applied here too.
      timeout: GIT_TIMEOUT_MS,
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
    // Explicit: `...user` would carry the RAW block through unvalidated, so a
    // malformed override would reach the resolver and fail there instead of
    // being reported once, at load, with a message naming the bad entry.
    overrides: parseOverrides(user.overrides, '.principlesrc'),
    rules: {
      'clean-code': mergeGroup(
        defaults.rules['clean-code'],
        user.rules?.['clean-code']
      ),
      'solid': mergeGroup(defaults.rules['solid'], user.rules?.['solid']),
      // A `.principlesrc` written before the arch group existed has no `arch`
      // key at all; `mergeGroup` then returns the defaults unchanged, which is
      // what AC-COMPAT-01 pins down.
      'arch': mergeGroup(defaults.rules['arch'], user.rules?.['arch'])
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

/**
 * How each key category is type-checked, and what the warning says when it is not.
 *
 * Every category follows the same shape -- skip when undefined, assign when the
 * value passes its guard, warn otherwise (#620). Stating the guard and the
 * expectation once per category lets one loop enforce all of them, instead of
 * four near-identical loops that each have to be kept in step by hand.
 */
type ValueGuard = {
  accepts: (value: unknown) => boolean;
  expectation: string;
  /** Coerce the accepted value before assignment (arrays are copied to detach). */
  coerce?: (value: unknown) => unknown;
};

const NUMERIC_GUARD: ValueGuard = {
  accepts: value => typeof value === 'number' && Number.isFinite(value),
  expectation: 'a finite number',
};

const ARRAY_GUARD: ValueGuard = {
  // Arrays REPLACE rather than concatenate, matching how .principlesrc is
  // written today (an exclude list is the project's complete list).
  accepts: value => Array.isArray(value),
  expectation: 'an array',
  coerce: value => [...(value as unknown[])],
};

function enumGuard(allowed: readonly string[]): ValueGuard {
  return {
    accepts: value => typeof value === 'string' && allowed.includes(value),
    // Loud on purpose: silently keeping the default would let a project believe
    // it raised a rule to blocking when it did not.
    expectation: `one of ${allowed.join(', ')}`,
  };
}

/** Merge one rule, keeping the default for any key whose override is mistyped. */
/**
 * Every rule key that carries a value category, paired with its guard.
 *
 * Built per call rather than cached: `ENUM_KEYS` values are read from the config that is
 * active when the merge runs, and a cached table would freeze the first one seen.
 */
function valueGuards(): Array<[string, ValueGuard]> {
  return [
    ...NUMERIC_KEYS.map((key): [string, ValueGuard] => [key, NUMERIC_GUARD]),
    ...ARRAY_KEYS.map((key): [string, ValueGuard] => [key, ARRAY_GUARD]),
    ...Object.entries(ENUM_KEYS).map(([key, allowed]): [string, ValueGuard] => [
      key,
      enumGuard(allowed as readonly string[]),
    ]),
  ];
}

/**
 * Copy one guarded value from the override onto the merged rule.
 *
 * An ABSENT key is not an error -- the base value stands. A PRESENT but unusable one is
 * warned about and also leaves the base value: silently accepting it would make a typo
 * look like a configured threshold.
 */
function mergeGuardedKey(
  merged: RuleConfig,
  override: Partial<RuleConfig>,
  key: keyof RuleConfig,
  guard: ValueGuard,
  ruleId: string,
): void {
  const value = override[key];
  if (value === undefined) return;
  if (!guard.accepts(value)) {
    warn(`rules.${ruleId}.${String(key)} must be ${guard.expectation} — keeping default`);
    return;
  }
  merged[key] = (guard.coerce ? guard.coerce(value) : value) as never;
}

function mergeRule(
  base: RuleConfig,
  override: Partial<RuleConfig>,
  ruleId: string
): RuleConfig {
  const merged: RuleConfig = { ...base };
  for (const [key, guard] of valueGuards()) {
    mergeGuardedKey(merged, override, key as keyof RuleConfig, guard, ruleId);
  }

  // `enabled` is a bare boolean, not one of the value categories above.
  if (typeof override.enabled === 'boolean') {
    merged.enabled = override.enabled;
  } else if (override.enabled !== undefined) {
    warn(`rules.${ruleId}.enabled must be a boolean — keeping default`);
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
// `resetActiveConfig()` between cases to avoid leaking state -- and doing so is
// no longer only a convention: `setActiveConfig` reports a replacement of an
// already-installed config, so the leak fails visibly instead of silently.
// ---------------------------------------------------------------------------

let activeConfig: PrinciplesConfig = getDefaultConfig();

// Set by setActiveConfig, cleared by resetActiveConfig. The concurrency contract
// above was documentation only; this makes an undocumented second set visible
// instead of letting the last writer silently win (walkthrough FC-02).
let activeConfigInstalled = false;

/** The configuration rules currently enforce. */
export function getActiveConfig(): PrinciplesConfig {
  return activeConfig;
}

/**
 * The effective configuration of one rule, read from what is being enforced NOW.
 *
 * `Rule.threshold` and `Rule.severity` are deprecated snapshots taken when the
 * rule module was constructed; a project's `.principlesrc` overrides them at
 * run time (#457). Consumers that report or compare thresholds must read them
 * here, or they will describe a number `check()` never compared against
 * (walkthrough MAJ-03 / FC-05).
 *
 * Fails on an unknown id rather than returning defaults: answering "there is no
 * such rule" with a plausible-looking threshold is the same silent-defaults
 * defect this module exists to remove.
 */
export function getEffectiveConfigFor(ruleId: string): RuleConfig {
  const separator = ruleId.indexOf('.');
  if (separator <= 0 || separator === ruleId.length - 1) {
    throw new Error(`rule id must be in group.name form, got "${ruleId}"`);
  }
  const group = ruleId.slice(0, separator);
  const name = ruleId.slice(separator + 1);
  const groups = activeConfig.rules as Record<string, Record<string, RuleConfig> | undefined>;
  const settings = groups[group]?.[name];
  if (!settings) {
    throw new Error(`no rule config for "${ruleId}" in the active configuration`);
  }
  return settings;
}

/** Install the configuration that rules should enforce. */
export function setActiveConfig(config: PrinciplesConfig): void {
  if (activeConfigInstalled) {
    warn('active config replaced without resetActiveConfig(); one process should analyse one project with one config');
  }
  activeConfig = config;
  activeConfigInstalled = true;
}

/**
 * Restore the built-in defaults.
 *
 * Exists for test isolation: without it, one test's `setActiveConfig` leaks into
 * the next and produces order-dependent failures.
 */
export function resetActiveConfig(): void {
  activeConfig = getDefaultConfig();
  activeConfigInstalled = false;
}

// ---------------------------------------------------------------------------
// Path-scoped severity overrides (#806)
// ---------------------------------------------------------------------------

/** Severity order, most to least severe. Used to forbid upward overrides. */
const SEVERITY_RANK: Record<string, number> = { error: 3, warning: 2, info: 1 };

/**
 * Translate a POSIX-style glob to a RegExp.
 *
 * Deliberately small: this supports the two shapes the feature needs (`**` across
 * directories, `*` within one segment) plus `?`. Anything richer belongs in a
 * glob library, and pulling a dependency into `src/npm-package` is forbidden.
 *
 * `**` becomes `.*` (so `**​/__tests__/**` matches a nested test dir AND an
 * absolute native path), `*` becomes `[^/]*`, and regex metacharacters are
 * escaped so a literal `.` in `*.test.ts` does not match `a_test.ts`.
 */
const REGEX_METACHARS = '\\^$.|+()[]{}';

/**
 * Consume a `**` run starting at `index`, returning the emitted pattern and the
 * index of the last character consumed.
 *
 * Split out of globToRegExp to keep its cyclomatic complexity under the Gate 3
 * block threshold: the double-star form has three sub-cases (bare, with a
 * trailing slash, and at the end) that read as nesting when inlined, and the
 * ratchet blocks new functions above CCN 10.
 */
function consumeDoubleStar(glob: string, index: number): { emit: string; last: number } {
  let last = index + 1;
  // A trailing slash is consumed too, so the prefix may match zero segments
  // (`src/__tests__/a.ts` matches a pattern ending in that prefix).
  if (glob[last + 1] === '/') last++;
  return { emit: '.*', last };
}

/**
 * Translate a single glob character to its regex fragment, or the character
 * itself when it is literal.
 */
function globCharToRegExp(ch: string): string {
  if (ch === '*') return '[^/]*';
  if (ch === '?') return '[^/]';
  if (REGEX_METACHARS.includes(ch)) return `\\${ch}`;
  return ch;
}

function globToRegExp(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*' && glob[i + 1] === '*') {
      const consumed = consumeDoubleStar(glob, i);
      out += consumed.emit;
      i = consumed.last;
      continue;
    }
    out += globCharToRegExp(ch);
  }
  return new RegExp(`^${out}$`);
}

/** Normalise a path for matching: native separators -> POSIX. */
function normaliseForMatch(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

/**
 * Whether `filePath` matches `glob`.
 *
 * Tries the whole path first, then every trailing segment run, so a repo-relative
 * glob also matches a file handed to the checker as an absolute native path. Gate
 * 4 passes repo-relative paths, but `--files` accepts absolute ones and the
 * override must not silently stop applying because the caller changed shape.
 */
function matchesGlob(filePath: string, glob: string): boolean {
  const target = normaliseForMatch(filePath);
  const re = globToRegExp(normaliseForMatch(glob));
  if (re.test(target)) return true;
  const segments = target.split('/');
  for (let i = 1; i < segments.length; i++) {
    if (re.test(segments.slice(i).join('/'))) return true;
  }
  return false;
}

/**
 * The severity to report for one rule on one file.
 *
 * Starts from the declared severity (the caller passes what the rule would emit)
 * and lets a matching override RELAX it. Relaxing only is enforced by rank, not
 * by convention: a stray override must never turn an advisory rule into a
 * blocker, because that would make the gate's reach depend on path globs nobody
 * reviewed.
 *
 * Never suppresses the violation -- the finding is still reported. Only its
 * severity changes, so the "passed with warnings" case stays distinguishable
 * from "nothing found".
 */
/**
 * The rank an override may apply, or undefined when it must be ignored.
 *
 * An override may only RELAX: an unknown severity, or one ranked at least as
 * severe as the declaration, is skipped rather than guessed at. Pulled out of
 * resolveSeverityForFile to keep that function under the Gate 3 block threshold.
 */
function usableOverrideRank(target: string | undefined, declaredRank: number): number | undefined {
  const targetRank = target === undefined ? undefined : SEVERITY_RANK[target];
  if (targetRank === undefined || targetRank >= declaredRank) return undefined;
  return targetRank;
}

export function resolveSeverityForFile(
  ruleId: string,
  filePath: string,
  declaredSeverity: string
): string {
  const overrides = activeConfig.overrides;
  if (!Array.isArray(overrides) || overrides.length === 0) return declaredSeverity;

  const declaredRank = SEVERITY_RANK[declaredSeverity] ?? 0;
  return overrides.reduce(
    (effective, entry) => applyOverride(effective, ruleId, filePath, entry, declaredRank),
    declaredSeverity,
  );
}

/**
 * Apply one override entry to the severity so far.
 *
 * Two gates before the entry counts: its severity must be USABLE, and its paths must
 * actually cover this file. Then the relax-only rule: a later override may lower the
 * severity further, never raise it back -- that direction is what keeps a path-scoped
 * entry from becoming a second, invisible gate policy.
 */
function applyOverride(
  effective: string,
  ruleId: string,
  filePath: string,
  entry: OverrideEntry,
  declaredRank: number,
): string {
  const targetRank = usableOverrideRank(entry?.rules?.[ruleId], declaredRank);
  if (!appliesTo(targetRank, entry, filePath, effective)) return effective;
  return entry.rules?.[ruleId] ?? effective;
}

/** One `overrides[]` entry, as the config declares it. */
interface OverrideEntry {
  rules?: Record<string, string>;
  paths?: string[];
}

/**
 * Whether this entry should take effect.
 *
 * Three gates, and the third is the RELAX-ONLY rule: a later override may lower the
 * severity further, never raise it back. That direction is what keeps a path-scoped entry
 * from becoming a second, invisible gate policy.
 */
function appliesTo(
  targetRank: number | undefined,
  entry: OverrideEntry,
  filePath: string,
  effective: string,
): boolean {
  if (targetRank === undefined) return false;
  if (!(entry.paths ?? []).some((p) => matchesGlob(filePath, p))) return false;
  return targetRank < (SEVERITY_RANK[effective] ?? 0);
}

/**
 * Validate the `overrides` block, dropping malformed entries with a warning.
 *
 * A config typo must not take Gate 4 down, and it must not silently do nothing
 * either -- both would be the silent-defaults defect this module removes. The
 * same reasoning as `mergeRule`, applied to a nested structure.
 */
/**
 * Validate one override entry's `rules` map, dropping unusable pairs.
 *
 * Extracted from parseOverrides to keep that function under the Gate 3 block
 * threshold: the two per-rule rejections (bad severity, missing group prefix)
 * made it CCN 15.
 */
function parseOverrideRules(
  rules: Record<string, unknown>,
  index: number,
  source: string
): Record<string, string> {
  const cleanRules: Record<string, string> = {};
  for (const [ruleId, severity] of Object.entries(rules)) {
    const problem = ruleOverrideProblem(ruleId, severity);
    if (problem) {
      warn(`overrides[${index}].rules["${ruleId}"] in ${source} ${problem} — ignored`);
      continue;
    }
    cleanRules[ruleId] = severity as string;
  }
  return cleanRules;
}

/** The rule ID prefix that marks a namespaced rule (`clean-code.long-function`). */
const RULE_ID_SEPARATOR = '.';

/**
 * Why this override pair is unusable, or null when it is fine.
 *
 * The rule ID must be NAMESPACED: an entry keyed `long-function` would match nothing,
 * and a silently non-matching override is the failure mode this module exists to remove.
 */
function ruleOverrideProblem(ruleId: string, severity: unknown): string | null {
  if (typeof severity !== 'string' || !(SEVERITIES as readonly string[]).includes(severity)) {
    return `must be one of ${SEVERITIES.join('|')}`;
  }
  if (ruleId.includes(RULE_ID_SEPARATOR)) return null;
  return 'must be "<group>.<rule>"';
}

/**
 * Validate one `overrides[]` entry, returning it or undefined when unusable.
 *
 * Extracted from parseOverrides so that function is just "loop and collect": the
 * three structural rejections (not an object, bad paths, bad rules) kept it at
 * CCN 11, over the Gate 3 block threshold.
 */
function parseOverrideEntry(
  entry: unknown,
  index: number,
  source: string
): SeverityOverride | undefined {
  if (!isPlainObject(entry)) {
    warn(`overrides[${index}] in ${source} must be an object — ignored`);
    return undefined;
  }
  const paths = overridePaths(entry.paths, index, source);
  if (!paths) return undefined;
  const rules = overrideRules(entry.rules, index, source);
  if (!rules) return undefined;
  return { paths, rules };
}

/**
 * The entry's `paths`, or null when unusable.
 *
 * Every element must be a STRING: a number in the list would be passed to the glob
 * matcher, which would throw on `.includes` rather than skip the entry.
 */
function overridePaths(raw: unknown, index: number, source: string): string[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.some((p) => typeof p !== 'string')) {
    warn(`overrides[${index}].paths in ${source} must be a non-empty string array — ignored`);
    return null;
  }
  return raw as string[];
}

/** The entry's cleaned `rules` map, or null when nothing usable survives. */
function overrideRules(raw: unknown, index: number, source: string): Record<string, string> | null {
  if (!isPlainObject(raw) || Object.keys(raw).length === 0) {
    warn(`overrides[${index}].rules in ${source} must be a non-empty object — ignored`);
    return null;
  }
  const clean = parseOverrideRules(raw as Record<string, unknown>, index, source);
  return Object.keys(clean).length === 0 ? null : clean;
}

function parseOverrides(raw: unknown, source: string): SeverityOverride[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    warn(`"overrides" in ${source} must be an array — ignored`);
    return [];
  }
  const out: SeverityOverride[] = [];
  for (const [index, entry] of raw.entries()) {
    const parsed = parseOverrideEntry(entry, index, source);
    if (parsed) out.push(parsed);
  }
  return out;
}