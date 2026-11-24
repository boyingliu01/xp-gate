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
function providerConfigError(role, expert, providerMap) {
  if (!isNonEmptyString(expert.provider) || expert.provider === 'local') {
    return `Expert ${role} must define a non-local callable provider.`;
  }
  const provider = providerMap[expert.provider];
  if (!provider || typeof provider !== 'object' || Array.isArray(provider)) {
    return `Expert ${role} provider configuration must be an object.`;
  }
  if (!isNonEmptyString(provider.base_url)) {
    return `Expert ${role} provider must define a non-empty base_url.`;
  }
  if (!isNonEmptyString(provider.api_key)) {
    return `Expert ${role} provider must define a non-empty api_key.`;
  }
  if (provider.timeout_ms !== undefined && !isValidTimeoutMs(provider.timeout_ms)) {
    return `Expert ${role} provider ${expert.provider} timeout_ms must be an integer between 1000 and 600000.`;
  }
  return null;
}

function validateDistinctModels(experts, providers, consensus = {}) {
  const expertMap = experts && typeof experts === 'object' ? experts : {};
  const providerMap = providers && typeof providers === 'object' ? providers : {};

  const collected = collectModelAssignments(expertMap);
  if (collected.error) return { valid: false, reason: collected.error };

  const duplicate = findDuplicateModel(collected.assignments);
  if (duplicate) return { valid: false, reason: duplicate };

  for (const role of REQUIRED_EXPERT_ROLES) {
    const error = providerConfigError(role, expertMap[role], providerMap);
    if (error) return { valid: false, reason: error };
  }

  if (consensus.cross_provider_required === true) {
    return {
      valid: true,
      warning: 'cross_provider_required_ignored',
    };
  }

  return { valid: true };
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

module.exports = { isNonEmptyString, collectModelAssignments, findDuplicateModel, providerConfigError, validateDistinctModels, isValidTimeoutMs, parseExpertVerdict };
