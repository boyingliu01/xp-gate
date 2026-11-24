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


module.exports = { isNonEmptyString, collectModelAssignments, findDuplicateModel, providerConfigError, validateDistinctModels, isValidTimeoutMs };
