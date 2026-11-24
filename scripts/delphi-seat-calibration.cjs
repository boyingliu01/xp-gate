'use strict';
/**
 * Seat calibration and failure classification (#481, #707).
 *
 * A seat that fails before answering is a different event from one whose answer
 * was wrong, and the two need different fixes: the first is usually a prompt too
 * large or a dropped connection, the second is the model's judgement.
 * `classifySeatFailure` is the single place that decides which one a caller is
 * looking at, and it carries the byte counts that let a report say "not
 * measurable" instead of guessing.
 *
 * Moved out of `delphi-external-review.cjs` to fit its line ceiling. Boundary
 * fixed first: eight functions, and `isPlainObject` (now defined here, imported
 * back by the runner) plus `isNonEmptyString` from the validation module.
 */

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// ── Seat prompt calibration (#481) ─────────────────────────────────────
// The R1-R4 sprint review proved the ceiling is a seat × model route
// property: g-glm-5.3-flash dropped 32-39 KB requests six times with
// "Network error." while the same gateway served 36 KB to a differently
// routed seat, and a ~60 byte smoke probe on the "dead" seat passed in 7s.
// The optional per-seat `prompt_calibration` record carries the measured
// bounds so failures can be classified against evidence instead of guessed.
// A calibration record is only usable when it carries a measured PASS bound
// and, if it also carries a FAIL bound, that bound is strictly larger. Each
// broken shape names itself so the operator knows which field to correct.
const CALIBRATION_SHAPE_HINT = 'needs measured_at and a finite last_pass_bytes > 0 (last_fail_bytes, if present, must be larger)';

function isPositiveFinite(value) {
  return Number.isFinite(value) && value > 0;
}

function calibrationProblem(raw) {
  if (!isPlainObject(raw)) return 'must be an object';
  const pass = raw.last_pass_bytes;
  const fail = raw.last_fail_bytes;
  const failOk = fail === undefined || isPositiveFinite(fail);
  if (!isPositiveFinite(pass) || !failOk) return CALIBRATION_SHAPE_HINT;
  if (fail !== undefined && !(fail > pass)) return 'has last_fail_bytes <= last_pass_bytes';
  if (!isNonEmptyString(raw.measured_at)) return CALIBRATION_SHAPE_HINT;
  return null;
}

function resolveSeatCalibration(expertConfig) {
  const raw = expertConfig && expertConfig.prompt_calibration;
  if (raw === undefined) return { calibration: null };
  const problem = calibrationProblem(raw);
  if (problem) {
    console.error(`[delphi-review] WARNING: prompt_calibration ${problem}; ignoring the record.`);
    return { calibration: null, warning: 'prompt_calibration_malformed' };
  }
  return {
    calibration: {
      measured_at: raw.measured_at,
      model_id: typeof raw.model_id === 'string' ? raw.model_id : undefined,
      gateway: typeof raw.gateway === 'string' ? raw.gateway : undefined,
      last_pass_bytes: Math.trunc(raw.last_pass_bytes),
      last_fail_bytes: raw.last_fail_bytes !== undefined ? Math.trunc(raw.last_fail_bytes) : undefined,
    },
  };
}

// Classify a failed expert call. A drop before any response on a payload above
// the seat's calibrated passing size is a size ceiling, not a transient fault:
// retrying the same payload cannot succeed, and reporting "Network error."
// sends operators chasing a cause that is not there (#481). Everything else
// gets a stable error_type so orchestrators can assert on the class instead of
// parsing prose.
// The calibrated ceiling for a seat, or null when the seat carries no usable
// record. Null is meaningful: it is the "no evidence to reclassify on" branch.
function calibratedCeiling(calibration) {
  if (calibration && Number.isFinite(calibration.last_pass_bytes)) return calibration.last_pass_bytes;
  return null;
}

// `error_kind` is the primary signal; the message literal stays as a
// backward-compatible fallback for callers that hand-build results.
function isPreResponseDrop(result) {
  return !result.retryable
    && (result.error_kind === 'pre_response_drop' || result.message === 'Network error.');
}

function sizeExceededResult(result, promptBytes, threshold) {
  return {
    ...result,
    error_type: 'SIZE_EXCEEDED',
    retryable: false,
    bytes: promptBytes,
    calibrated_pass_bytes: threshold,
    message: `Request dropped before any response: ${promptBytes} bytes exceeds this seat's calibrated passing size `
      + `(${threshold} bytes). Classified SIZE_EXCEEDED, not a network fault — trim the payload or recalibrate the seat.`,
  };
}

// No calibration means no evidence to reclassify on — but an uncalibrated
// seat dying on a full-budget payload is exactly how #481 started. Keep the
// class honest (network_error) and point the operator at the protocol.
function uncalibratedBudgetHint(result, promptBytes) {
  return {
    ...result,
    error_type: 'network_error',
    bytes: promptBytes,
    message: `${result.message} Note: this seat has no prompt_calibration record and the payload is at the `
      + 'default budget — this pattern matches an uncalibrated size ceiling. Recalibrate per the #481 protocol.',
  };
}

function classifySeatFailure({ result, promptBytes, calibration }) {
  if (!result || !result.error) return result;
  if (!isPreResponseDrop(result)) {
    return { ...result, error_type: result.retryable ? 'retryable_error' : 'network_error' };
  }
  const threshold = calibratedCeiling(calibration);
  if (!Number.isFinite(promptBytes)) {
    return { ...result, error_type: 'network_error' };
  }
  if (threshold !== null && promptBytes > threshold) {
    return sizeExceededResult(result, promptBytes, threshold);
  }
  if (threshold === null && promptBytes >= DEFAULT_PROMPT_BUDGET_BYTES) {
    return uncalibratedBudgetHint(result, promptBytes);
  }
  return { ...result, error_type: 'network_error' };
}


const { isNonEmptyString } = require('./delphi-model-validation.cjs');

/** The prompt budget used when a profile does not declare one. */
const DEFAULT_PROMPT_BUDGET_BYTES = 40000;
module.exports = { isPlainObject, DEFAULT_PROMPT_BUDGET_BYTES, isPositiveFinite, calibrationProblem, resolveSeatCalibration, calibratedCeiling, isPreResponseDrop, sizeExceededResult, uncalibratedBudgetHint, classifySeatFailure };
