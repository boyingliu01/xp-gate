/**
 * Resolve the Delphi review seats out of `.delphi-config.json`.
 *
 * WHY THIS IS ITS OWN MODULE
 * --------------------------
 * `verify` used to read the seats straight from a top-level `pinned_models`
 * key. That key is not part of the shipped schema: seats live under
 * `profiles[active_profile].experts`, each carrying `provider` and `model`,
 * and the product resolves them from there (delphi-review/SKILL.md step 1).
 * So a perfectly valid config reported "pinned_models 只有 0 席" and every
 * verify run failed -- and a check that is always red stops being read, which
 * is worse than the check not existing.
 *
 * It lives here rather than inside verify.mjs because verify.mjs is a script
 * with top-level side effects and cannot be imported, so the seat resolution
 * could not be tested at all. Both the current and the legacy shape are
 * accepted: an older file must keep verifying, not be told to migrate.
 */

/**
 * @param {object|null} config parsed `.delphi-config.json`
 * @returns {Array<[string, {model?: string, provider?: string, legacy?: boolean}]>}
 *   `[role, seat]` pairs. Empty when the config is missing or has no matches.
 */
export function delphiSeats(config) {
  if (!config || typeof config !== 'object') return [];

  const legacy = legacySeats(config);
  if (legacy.length) return legacy;

  return profileSeats(config);
}

/** Seats in the pre-schema top-level shape, or [] when the file does not use it. */
function legacySeats(config) {
  return Object.entries(config.pinned_models || {})
    .map(([role, model]) => [role, { model, provider: null, legacy: true }]);
}

/** Seats of the active profile, which is the shipped shape. */
function profileSeats(config) {
  const profile = (config.profiles || {})[config.active_profile] || {};
  return Object.entries(profile.experts || {}).map(([role, seat]) => [role, seat || {}]);
}

/** The model name a seat resolves to, or '' when it does not name one. */
export function seatModel(seat) {
  const value = seat && (seat.model ?? seat);
  return value === undefined || value === null ? '' : String(value).trim();
}

/**
 * The distinct model names across a seat list.
 *
 * Delphi requires three *different* models: three seats all bound to one model
 * would look like a panel while being a single opinion, which is the failure
 * the whole method exists to prevent.
 */
export function distinctModels(seats) {
  return new Set(seats.map(([, seat]) => seatModel(seat)).filter(Boolean));
}
