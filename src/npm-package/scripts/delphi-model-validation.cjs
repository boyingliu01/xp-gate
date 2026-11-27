'use strict';
/**
 * The distinct-model rule, and the reasons it exists.
 *
 * A Delphi review is only anonymous if the three seats are genuinely different
 * models. Pinning them to three names that resolve to one model produces a
 * convincing report written by one model three times -- which is why
 * `unavailable_duplicate` is a hard failure rather than a warning.
 *
 * Pure validation: config in, verdict out. Moved out of
 * `delphi-external-review.cjs` to keep that file under its 1,050-line ceiling.
 * The boundary was fixed before moving: five functions plus `isValidTimeoutMs`,
 * which `providerConfigError` calls and nothing else in the runner uses.
 */
/**
 * Whether `value` is a plain object (not null, an array, or a class instance).
 *
 * Defined here rather than imported from `delphi-seat-calibration.cjs`: that module
 * requires THIS one, so importing back would close a cycle and hand out `undefined`
 * at load time.
 */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}


function isValidTimeoutMs(value) {
  return Number.isInteger(value) && value >= 1000 && value <= 600000;
}

// ── Distinct-model validation ───────────────────────────────────────────
const REQUIRED_EXPERT_ROLES = ['architecture', 'technical', 'feasibility'];

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

// Roles must be EXACTLY the three required ones: a missing role means the
// review would silently run with two experts, an extra one means the config
// no longer matches the three-model policy. One pass reports both.
function collectModelAssignments(expertMap) {
  const assignments = [];
  for (const role of REQUIRED_EXPERT_ROLES) {
    const expert = expertMap[role];
    if (!expert) return { error: `Missing required expert role: ${role}.` };
    if (!isNonEmptyString(expert.model)) {
      return { error: `Expert ${role} must define a non-empty model.` };
    }
    assignments.push({ role, model: expert.model.trim() });
  }
  const unexpectedRole = Object.keys(expertMap).find(role => !REQUIRED_EXPERT_ROLES.includes(role));
  if (unexpectedRole) return { error: `Unsupported expert role: ${unexpectedRole}.` };
  return { assignments };
}

function findDuplicateModel(assignments) {
  const seen = new Map();
  for (const { role, model } of assignments) {
    const previousRole = seen.get(model);
    if (previousRole) {
      return `duplicate model "${model}" assigned to ${previousRole} and ${role}.`;
    }
    seen.set(model, role);
  }
  return null;
}

// Everything an expert's provider must carry to be callable. Returns the
// human-readable reason instead of throwing, so the caller keeps one shape.
/**
 * The checks a provider binding must pass, in the order they are reported.
 *
 * A table because each rule's message is different and each is a sentence about the
 * config; as an if-ladder they were five early returns whose conditions all had to be
 * read together to see there is an ordering at all.
 *
 * The order is by SPECIFICITY: "must define a provider" before "must be an object",
 * before the fields inside it -- so a missing provider is never reported as a
 * malformed one.
 */
const PROVIDER_RULES = [
  {
    fails: (expert) => !isNonEmptyString(expert.provider) || expert.provider === 'local',
    message: (role) => `Expert ${role} must define a non-local callable provider.`,
  },
  {
    fails: (_expert, provider) => !provider || typeof provider !== 'object' || Array.isArray(provider),
    message: (role) => `Expert ${role} provider configuration must be an object.`,
  },
  {
    fails: (_expert, provider) => !isNonEmptyString(provider?.base_url),
    message: (role) => `Expert ${role} provider must define a non-empty base_url.`,
  },
  {
    fails: (_expert, provider) => !isNonEmptyString(provider?.api_key),
    message: (role) => `Expert ${role} provider must define a non-empty api_key.`,
  },
  {
    fails: (_expert, provider) => provider?.timeout_ms !== undefined
      && !isValidTimeoutMs(provider.timeout_ms),
    message: (role, _provider, expert) => `Expert ${role} provider ${expert.provider} timeout_ms must be an integer between 1000 and 600000.`,
  },
];

/** Why this expert's provider binding is unusable, or null when it is fine. */
function providerConfigError(role, expert, providerMap) {
  const provider = expert ? providerMap[expert.provider] : undefined;
  const broken = PROVIDER_RULES.find((rule) => rule.fails(expert, provider));
  return broken ? broken.message(role, provider, expert) : null;
}

/**
 * Why the model assignments are unusable, or null when they are distinct.
 *
 * Both checks live here because they use the SAME collected list: re-collecting for
 * the second check would let the two disagree about what the config says.
 */
function collectAndCheckDuplicates(expertMap) {
  const collected = collectModelAssignments(expertMap);
  if (collected.error) return collected.error;
  return findDuplicateModel(collected.assignments);
}

/**
 * Normalise the two maps a config may omit entirely.
 *
 * A config that names no experts is not a malformed map -- it is an empty one, and the
 * required-role check below reports each missing seat.
 */
function asMap(value) {
  return value && typeof value === 'object' ? value : {};
}

function validateDistinctModels(experts, providers, consensus = {}) {
  const expertMap = asMap(experts);
  const providerMap = asMap(providers);

  const assignmentError = collectAndCheckDuplicates(expertMap);
  if (assignmentError) return { valid: false, reason: assignmentError };

  const providerError = firstProviderError(expertMap, providerMap);
  if (providerError) return { valid: false, reason: providerError };

  // `cross_provider_required` is IGNORED, not obeyed: the three seats must be distinct
  // MODELS, and requiring distinct providers as well would reject configs that are
  // already anonymous. Reported as a warning so the reader knows it had no effect.
  if (consensus.cross_provider_required === true) {
    return { valid: true, warning: 'cross_provider_required_ignored' };
  }
  return { valid: true };
}
/**
 * The first required role whose provider binding is unusable, or null.
 *
 * Reported one at a time, in role order: the first broken binding is the one to fix,
 * and listing all of them would bury it.
 */
function firstProviderError(expertMap, providerMap) {
  for (const role of REQUIRED_EXPERT_ROLES) {
    const error = providerConfigError(role, expertMap[role], providerMap);
    if (error) return error;
  }
  return null;
}


const EXPERT_VERDICTS = ['APPROVED', 'REQUEST_CHANGES', 'REJECTED'];

/** Confidence is a 1-10 integer scale, not a percentage. */
const MIN_CONFIDENCE = 1;
const MAX_CONFIDENCE = 10;

/** Every issue list an expert verdict must carry, as string arrays. */
const ISSUE_FIELDS = ['critical_issues', 'major_concerns', 'minor_concerns'];

/** Whether `value` is one of the documented verdicts. */
function hasKnownVerdict(value) {
  return EXPERT_VERDICTS.includes(value);
}

/** Whether `value` is a confidence inside the documented scale. */
function hasValidConfidence(value) {
  if (!Number.isFinite(value)) return false;
  return value >= MIN_CONFIDENCE && value <= MAX_CONFIDENCE;
}

/**
 * Whether every issue field is a list of STRINGS.
 *
 * A list holding a number or a nested object reaches the report and renders as
 * "[object Object]" in the summary -- which is how a real finding gets lost.
 */
function hasIssueLists(value) {
  return ISSUE_FIELDS.every(
    (field) => Array.isArray(value[field]) && value[field].every((item) => typeof item === 'string'),
  );
}

/** The verdict, when it passes every rule; null otherwise. */
/** Whether the verdict object carries every field the report needs, validly. */
function hasAllVerdictFields(value) {
  if (!isPlainObject(value)) return false;
  if (!hasKnownVerdict(value.verdict)) return false;
  if (!hasValidConfidence(value.confidence)) return false;
  if (!hasIssueLists(value)) return false;
  return typeof value.summary === 'string';
}

function validExpertVerdict(value) {
  if (!hasAllVerdictFields(value)) return null;
  return {
    verdict: value.verdict,
    confidence: value.confidence,
    critical_issues: value.critical_issues,
    major_concerns: value.major_concerns,
    minor_concerns: value.minor_concerns,
    summary: value.summary,
  };
}

/**
 * Parse one expert's verdict.
 *
 * The rejection message is the SAME for every failure on purpose: this runs on model
 * output, and telling a remote caller which field was wrong would invite a retry that
 * games the validator instead of answering the review.
 */
function parseExpertVerdict(value) {
  const verdict = validExpertVerdict(value);
  if (!verdict) return { valid: false, message: 'Invalid expert verdict.' };
  return { valid: true, verdict };
}

/**
 * Read a numeric consensus setting and clamp it into its allowed range.
 *
 * Two settings did this identically: coerce to a number, clamp to a floor and a
 * ceiling, fall back to the default when the value is not usable, and warn when
 * the configured value differs from the one actually used. The warning is the
 * point -- a silently clamped threshold changes what "consensus" means on that
 * machine.
 *
 * `clamped` means a CONFIGURED value was changed. An absent value uses the
 * default and reports no clamp: telling the operator a setting they never wrote
 * had been altered is a false alarm.
 *
 * @param {*} configured raw value from the config
 * @param {{min: number, max: number, fallback: number, clamp: (n: number) => number}} bounds
 * @returns {{value: number, clamped: boolean}}
 */
function clampConsensusSetting(configured, bounds) {
  const usable = typeof configured === 'number' && Number.isFinite(configured);
  const value = usable ? bounds.clamp(configured) : bounds.fallback;
  // "Clamped" covers BOTH ways a configured value stops applying: out of range
  // (0 rounds -> 1) and unusable ('high' -> the default). The existing contract
  // treats an unparseable value as a change worth reporting, and it is -- a
  // setting the operator wrote is not the one in force either way.
  return { value, clamped: configured !== undefined && configured !== value };
}

/**
 * Expand a `${VAR}` placeholder, or fail loudly.
 *
 * `api_key` and `base_url` each had their own copy, and the `base_url` one was
 * ADDED later for a reason worth keeping: without expansion the literal text
 * `${PG_GATEWAY}/v1/chat/completions` is a valid non-empty URL, so validation
 * passed and the failure surfaced at the network layer as a DNS error while the
 * config looked correct.
 *
 * Only a WHOLE `${NAME}` is a placeholder. `${A}${B}` is a template somebody may
 * be assembling, and refusing it would reject a config that needs no expansion.
 *
 * @param {*} value
 * @param {string} field 'api_key' | 'base_url'
 * @param {string} profileName
 * @param {string} providerName
 * @returns {*} the expanded value, or the original
 */
function expandEnvPlaceholder(value, field, profileName, providerName) {
  if (typeof value !== 'string') return value;
  const match = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(value);
  if (!match) return value;
  const envName = match[1];
  const envVal = process.env[envName];
  if (envVal) return envVal;
  console.error(
    `[delphi-review] ERROR: Environment variable ${envName} is not set `
    + `(profiles.${profileName}.providers.${providerName}.${field}). `
    + 'Export it or point that provider at a literal value.',
  );
  process.exit(1);
  return value;
}

module.exports = { isPlainObject, isNonEmptyString, collectModelAssignments, findDuplicateModel, providerConfigError, validateDistinctModels, isValidTimeoutMs, parseExpertVerdict, clampConsensusSetting, expandEnvPlaceholder };
