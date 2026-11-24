#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// ── Node.js version check ──────────────────────────────────────────────
function checkNodeVersion() {
  const major = parseInt(process.versions.node.split('.')[0]);
  if (major < 18) {
    console.error(`[delphi-review] ERROR: Node.js >= 18 required (current: ${process.versions.node})`);
    process.exit(1);
  }
  return true;
}

// ── Argument parsing ───────────────────────────────────────────────────
const VALID_EXPERTS = ['architecture', 'technical', 'feasibility'];
const VALID_MODES = ['design', 'code-walkthrough', 'requirements'];
const DEFAULT_TIMEOUT_MS = 30000;

// Shared by CLI --timeout-ms and provider timeout_ms validation.

// Flag -> args key. `null` marks flags that take no value. Keeping this as data
// means a new flag is one table row instead of one more switch arm (the switch
// had grown to ten arms plus a special case for --timeout-ms).
const VALUE_FLAGS = {
  '--expert': 'expert',
  '--input': 'input',
  '--input-file': 'inputFile',
  '--round': 'round',
  '--config': 'config',
  '--mode': 'mode',
  '--profile': 'profile',
  '--other-experts-file': 'otherExpertsFile',
};
const BOOLEAN_FLAGS = { '--fallback-local': 'fallbackLocal' };
const INTEGER_FLAGS = { '--round': (v) => parseInt(v) };

function collectRawArgs(argv) {
  const args = {};
  let timeoutMsRaw;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--timeout-ms') { timeoutMsRaw = argv[++i]; continue; }
    if (BOOLEAN_FLAGS[flag]) { args[BOOLEAN_FLAGS[flag]] = true; continue; }
    const key = VALUE_FLAGS[flag];
    if (!key) continue;
    const value = argv[++i];
    args[key] = INTEGER_FLAGS[flag] ? INTEGER_FLAGS[flag](value) : value;
  }
  return { args, timeoutMsRaw };
}

function fail(message) {
  console.error(`[delphi-review] ERROR: ${message}`);
  process.exit(1);
}

// Every rejection path used to inline its own console.error + exit. Collected
// here so the rules read as rules and each message stays verbatim.
function missingArgumentList(args) {
  const missing = [];
  if (!args.expert) missing.push('--expert');
  if (!args.input && !args.inputFile) missing.push('--input or --input-file');
  if (!args.round) missing.push('--round');
  if (!args.config) missing.push('--config');
  return missing;
}

function applyTimeoutFlag(args, timeoutMsRaw) {
  if (timeoutMsRaw === undefined) return;
  const parsed = /^\d+$/.test(timeoutMsRaw) ? Number(timeoutMsRaw) : NaN;
  if (!isValidTimeoutMs(parsed)) {
    fail('--timeout-ms must be an integer between 1000 and 600000.');
  }
  args.timeoutMs = parsed;
}

function resolveMode(args) {
  if (!args.mode) args.mode = 'design';
  if (!VALID_MODES.includes(args.mode)) {
    fail(`Invalid mode "${args.mode}". Must be one of: ${VALID_MODES.join(', ')}`);
  }
}

function requireArgs(args, timeoutMsRaw) {
  const missing = missingArgumentList(args);
  if (missing.length > 0) {
    fail(`Missing required arguments: ${missing.join(', ')}`);
  }
  if (!VALID_EXPERTS.includes(args.expert)) {
    fail(`Invalid expert role "${args.expert}". Must be one of: ${VALID_EXPERTS.join(', ')}`);
  }
  if (args.input && args.inputFile) {
    fail('--input and --input-file are mutually exclusive. Use only one.');
  }
  applyTimeoutFlag(args, timeoutMsRaw);
  resolveMode(args);
}

function parseArgs(argv) {
  const { args, timeoutMsRaw } = collectRawArgs(argv);
  requireArgs(args, timeoutMsRaw);
  return args;
}

// ── Config reading ─────────────────────────────────────────────────────
// Provider fields used to be checked only inside the per-expert loop, so a
// malformed provider nobody currently points an expert at survived silently and
// only surfaced at runtime (a bad timeout_ms fell back to the default). The
// whole profile is checked here instead, at the system boundary, naming the
// provider so the fix is obvious (#429).
function validateProviders(providers, profileName) {
  for (const [name, provider] of Object.entries(providers)) {
    const providerPath = `profiles.${profileName}.providers.${name}`;
    const fail = (detail) => {
      console.error(`[delphi-review] ERROR: ${providerPath} ${detail}`);
      process.exit(1);
    };

    if (!isPlainObject(provider)) fail('must be an object.');
    if (typeof provider.base_url !== 'string' || provider.base_url.trim() === '') fail('must define a non-empty base_url.');
    if (typeof provider.api_key !== 'string' || provider.api_key.trim() === '') fail('must define a non-empty api_key.');
    if (provider.timeout_ms !== undefined && !isValidTimeoutMs(provider.timeout_ms)) {
      fail('timeout_ms must be an integer between 1000 and 600000.');
    }
  }
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

/**
 * Resolve and parse the config file.
 *
 * Split out of `readConfig`, which had grown past the 50-line bound by holding
 * two jobs: decide WHICH file, then decide what it means. The first job carries
 * a real hazard worth testing on its own -- a relative `--config` that this cwd
 * lacks resolves to the machine-wide config, but only when the project file is
 * genuinely ABSENT. Any other stat error aborts rather than silently routing the
 * run to another config, which once routed calls to expensive models.
 *
 * @param {string} configPath
 * @returns {object} the parsed config
 */
function loadConfigFile(configPath) {
  // Global fallback: a relative --config that this cwd does not have resolves
  // to the machine-wide ~/.config/xp-gate/.delphi-config.json. This is what
  // makes `--config .delphi-config.json` work from ANY project without each
  // repo carrying its own (drifting, differently-priced) copy — reading a
  // foreign project's config used to route calls to expensive models
  // (2026-10-03 quota incident). An existing local file always wins.
  // Fallback fires ONLY when the project file is genuinely absent: statSync
  // distinguishes ENOENT from EACCES/EISDIR, and any other error aborts here
  // rather than silently routing this run to another config — matching the
  // TS loader's ENOENT-only semantics (walkthrough R10 FC-01).
  const missingHere = (() => {
    try { fs.statSync(configPath); return false; } catch (e) { return e.code === 'ENOENT'; }
  })();
  if (missingHere && !path.isAbsolute(configPath)) {
    // r16 MA-01 disposition: XDG_CONFIG_HOME is an accepted override for the
    // global config location. The CLI lib (shared-paths/doctor) intentionally
    // pins ~/.config/xp-gate — overriding only this loader would make the two
    // disagree. On Linux, $HOME/.config IS the XDG default, so behaviour there
    // is identical; the env var only matters for non-default setups.
    // Extracted so all three resolution points share one definition (REQ-636).
    const globalPath = globalConfigPath(process.env);
    if (fs.existsSync(globalPath)) {
      console.error(`[delphi-review] ${configPath} not found here — using global config ${globalPath}`);
      configPath = globalPath;
    }
  }
  if (!fs.existsSync(configPath)) {
    console.error(`[delphi-review] ERROR: Config file not found: ${configPath}`);
    console.error('[delphi-review] Copy .delphi-config.json.example to .delphi-config.json and fill in your API keys.');
    process.exit(1);
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    console.error(`[delphi-review] ERROR: Failed to parse config: ${err.message}`);
    process.exit(1);
  }
  return raw;
}

/**
 * Look up the named profile, or fail with the list of what IS available.
 *
 * Naming the alternatives is the whole value of the branch: "profile not found"
 * alone leaves the operator re-reading a file that may be perfectly valid under a
 * different key.
 *
 * @param {object} raw parsed config
 * @param {string} profileName
 * @returns {object}
 */
function requireProfile(raw, profileName) {
  const profile = raw.profiles?.[profileName];
  if (profile) return profile;
  console.error(`[delphi-review] ERROR: Profile "${profileName}" not found in config.`);
  console.error(`[delphi-review] Available profiles: ${Object.keys(raw.profiles || {}).join(', ')}`);
  process.exit(1);
  return profile;
}

/**
 * Expand every provider's `${VAR}` placeholders in place, after validating shape.
 *
 * `validateProviders` runs FIRST so a structurally broken provider is reported as
 * such rather than as a missing environment variable.
 *
 * @param {object} profile
 * @param {string} profileName
 * @returns {object} the providers map, with placeholders resolved in place
 */
function resolveProviderCredentials(profile, profileName) {
  const providers = profile.providers || {};
  validateProviders(providers, profileName);
  for (const [name, prov] of Object.entries(providers)) {
    prov.api_key = expandEnvPlaceholder(prov.api_key, 'api_key', profileName, name);
    prov.base_url = expandEnvPlaceholder(prov.base_url, 'base_url', profileName, name);
  }
  return providers;
}

function readConfig(configPath, profileOverride) {
  const raw = loadConfigFile(configPath);

  const profileName = profileOverride || raw.active_profile || 'default';
  const profile = requireProfile(raw, profileName);
  const providers = resolveProviderCredentials(profile, profileName);

  const experts = Object.fromEntries(Object.entries(profile.experts || {}).map(([role, expert]) => [
    role,
    {
      ...expert,
      model: typeof expert.model === 'string' ? expert.model.trim() : expert.model,
    },
  ]));
  const warnings = [];
  if (raw.consensus?.distinct_models_required === false) {
    warnings.push('distinct_models_required_forced');
  }
  // The 90 floor is a policy, not a default: a config may raise the bar, never
  // lower it. The 5-round cap bounds cost; the 1-round floor bounds meaning.
  const threshold = clampConsensusSetting(raw.consensus?.threshold_percent, {
    min: 90, max: Number.MAX_SAFE_INTEGER, fallback: 90, clamp: (n) => Math.max(90, n),
  });
  const thresholdPercent = threshold.value;
  if (threshold.clamped) warnings.push('threshold_percent_clamped');

  const rounds = clampConsensusSetting(raw.consensus?.max_review_rounds, {
    min: 1, max: 5, fallback: 5, clamp: (n) => Math.min(5, Math.max(1, Math.trunc(n))),
  });
  const maxReviewRounds = rounds.value;
  if (rounds.clamped) warnings.push('max_review_rounds_clamped');

  return {
    active_profile: profileName,
    providers,
    experts,
    consensus: {
      ...(raw.consensus || {}),
      threshold_percent: thresholdPercent,
      max_review_rounds: maxReviewRounds,
      distinct_models_required: true,
    },
    warnings,
  };
}

const {
  isNonEmptyString,
  collectModelAssignments,
  findDuplicateModel,
  providerConfigError,
  validateDistinctModels,
  isValidTimeoutMs,
} = require('./delphi-model-validation.cjs');

// ── JSON extraction (4-layer fallback) ─────────────────────────────────
const { extractJsonFromResponse } = require('./delphi-json-extract.cjs');

// ── System prompt templates ────────────────────────────────────────────
const { SYSTEM_PROMPTS, MODE_FOCUS_PROMPTS } = require('./delphi-prompts.cjs');

function buildSystemPrompt(role, mode = 'design') {
  const rolePrompt = SYSTEM_PROMPTS[role] || SYSTEM_PROMPTS.architecture;
  return `${rolePrompt}${MODE_FOCUS_PROMPTS[mode] || ''}`;
}

// ── User prompt construction ───────────────────────────────────────────
function buildUserPrompt(reviewContent, otherExpertsJson, round) {
  let prompt = `请评审以下内容（Round ${round}）：\n\n---\n${reviewContent}\n---`;

  if (otherExpertsJson && round > 1) {
    prompt += `\n\n以下是其他专家在 Round ${round - 1} 中的意见，请在考虑这些意见后重新评审：\n\n${otherExpertsJson}`;
  }

  return prompt;
}

// ── Input content resolution ───────────────────────────────────────────
function resolveInputContent(args) {
  if (args.inputFile) {
    // One read, not exists-then-read: the check-then-use pair has a window in
    // which the file can vanish, and the ENOENT that follows would surface as an
    // unhandled throw instead of the message below.
    try {
      return fs.readFileSync(args.inputFile, 'utf8');
    } catch (err) {
      console.error(`[delphi-review] ERROR: Cannot read input file ${args.inputFile}: ${err.message}`);
      process.exit(1);
      return '';
    }
  }
  return args.input || '';
}

// ── Timeout resolution ─────────────────────────────────────────────────
// CLI --timeout-ms > provider timeout_ms > default (30000, unchanged behavior).
function resolveTimeoutMs(args, providerConfig) {
  if (args && isValidTimeoutMs(args.timeoutMs)) return args.timeoutMs;
  if (providerConfig && isValidTimeoutMs(providerConfig.timeout_ms)) return providerConfig.timeout_ms;
  return DEFAULT_TIMEOUT_MS;
}

// ── Prompt budget ──────────────────────────────────────────────────────
// Measured on the whalecloud gateway during the #457 walkthrough: a 40 KB prompt
// answered normally, a 50 KB one killed the seat with no usable error, and a
// dead expert seat blocks the whole review. The ceiling is therefore checked
// before the request is made, where the message can say what to narrow.

// A seat-level override (`max_prompt_bytes` on the expert entry) exists because
// the ceiling is a property of the model behind the seat, not of the runner.
// Values that cannot be honoured fall back to the default rather than disabling
// the guard -- `max_prompt_bytes: 0` reads as "no limit" and is not.
function resolvePromptBudgetBytes(expertConfig) {
  const configured = expertConfig && expertConfig.max_prompt_bytes;
  if (typeof configured === 'number' && Number.isFinite(configured) && configured > 0) {
    return Math.trunc(configured);
  }
  if (configured !== undefined) {
    // Silently falling back is how a raised ceiling looks like a still-broken
    // guard: the operator edits the config, the run still refuses, and nothing
    // says the value never took effect.
    console.error(
      `[delphi-review] WARNING: max_prompt_bytes=${JSON.stringify(configured)} cannot be honoured ` +
      `(needs a finite number > 0); using the ${DEFAULT_PROMPT_BUDGET_BYTES} byte default instead.`
    );
  }
  return DEFAULT_PROMPT_BUDGET_BYTES;
}

// Bytes, never `String.length`: review content is Chinese prose, and a code-unit
// count understates what the gateway actually receives by up to 3x.
function checkPromptBudget({ systemPrompt, userPrompt, maxBytes }) {
  const bytes = Buffer.byteLength(String(systemPrompt ?? ''), 'utf8')
    + Buffer.byteLength(String(userPrompt ?? ''), 'utf8');
  return { ok: bytes <= maxBytes, bytes, maxBytes };
}

function describePromptBudgetFailure({ bytes, maxBytes, expert }) {
  return (
    `Prompt for expert "${expert}" is ${bytes} bytes, over the ${maxBytes} byte budget. ` +
    'The gateway drops oversized requests without a diagnosable error, so this run ' +
    'refuses to send it. Narrow the review range (fewer commits or files, or exclude ' +
    'vendored/lockfile content), or raise the seat\'s `max_prompt_bytes` in ' +
    '.delphi-config.json if this model is known to accept larger requests.'
  );
}

// ── Seat prompt calibration (#481) ─────────────────────────────────────
const {
  isPlainObject,
  DEFAULT_PROMPT_BUDGET_BYTES,
  isPositiveFinite,
  calibrationProblem,
  resolveSeatCalibration,
  calibratedCeiling,
  isPreResponseDrop,
  sizeExceededResult,
  uncalibratedBudgetHint,
  classifySeatFailure,
} = require('./delphi-seat-calibration.cjs');

// ── Schema retry (#414 REQ-5) ──────────────────────────────────────────
// g-qwen3.8-flash occasionally answers in prose or malformed JSON (measured
// during the 2026-09-17 Qoder walkthrough). One retry whose system prompt
// restates the JSON schema explicitly recovers those; a same-prompt retry
// does not. Exactly one: a model that cannot echo the schema after being
// shown it will not improve on a third attempt.
const SCHEMA_RESTATEMENT = '\n\n【输出格式强制重申 — 上一次回复无法解析为合法评审 JSON】\n'
  + '你的回复必须且只能是一个 JSON 对象，不得包含任何解释、markdown 代码块或前后缀文字。字段与类型：\n'
  + '{\n'
  + '  "verdict": "APPROVED" | "REQUEST_CHANGES" | "REJECTED",\n'
  + '  "confidence": <1-10 的整数>,\n'
  + '  "critical_issues": ["字符串", ...],\n'
  + '  "major_concerns": ["字符串", ...],\n'
  + '  "minor_concerns": ["字符串", ...],\n'
  + '  "summary": "字符串"\n'
  + '}\n'
  + '三个 concern 数组的每一项都必须是字符串（可含 "CI-01: " 等前缀），绝不能是对象。';

async function callExpertWithSchemaRetry({ provider, model, systemPrompt, userPrompt, timeoutMs, maxRetries = 2, callFn } = {}) {
  const call = callFn || callWithRetry;
  const result = await call(provider, model, systemPrompt, userPrompt, maxRetries, timeoutMs);
  // An API failure keeps its own retry loop (callWithRetry); the schema path
  // must not turn an exhausted transport into an extra model round.
  if (result.error) return result;
  const parsed = parseExpertVerdict(extractJsonFromResponse(result.content));
  if (parsed.valid) return { ...result, verdict: parsed.verdict };

  const retryResult = await call(
    // maxRetries=0 means the transport loop runs exactly one attempt
    // (callWithRetry iterates `attempt <= maxRetries`) — the schema path adds
    // one model round, never an extra transport-retry chain. The 7th argument
    // is a tag consumed by injectable callFn stubs in tests.
    provider, model, systemPrompt + SCHEMA_RESTATEMENT, userPrompt, 0, timeoutMs, 'schema-retry:1',
  );
  if (retryResult.error) return { ...retryResult, retry: 1 };
  const retryParsed = parseExpertVerdict(extractJsonFromResponse(retryResult.content));
  if (retryParsed.valid) return { ...retryResult, verdict: retryParsed.verdict, retry: 1 };
  return {
    error: true,
    message: `Expert response could not be parsed as a valid verdict after one schema retry: ${parsed.message}`,
    retry: 1,
    resolved_model: typeof retryResult.resolved_model === 'string' ? retryResult.resolved_model : result.resolved_model,
  };
}

// ── API call ───────────────────────────────────────────────────────────

/**
 * Map a 429 to a verdict. Not every 429 is a transient rate limit — WhaleCloud
 * returns `type: "budget_exceeded"` in two distinct non-retryable cases, and a
 * blind retry cannot clear either and would burn two round-trips before failing:
 *   - `error.param === "category_quota"`: the account has no ECONOMY/STANDARD
 *     quota configured for the model ("需要专项额度...尚未配置") — needs an admin.
 *   - `error.param === "cost_quota"`: the account's daily spending cap is
 *     exhausted ("今日额度已耗尽...限额: 100.00元") — resets the next day.
 * Surface which kind it is so the caller knows whether to wait or to ask for an
 * admin change, rather than treating both as a generic rate limit.
 *
 * Extracted from `callModelAPI` so the branch reads as one rule (#722 follow-up:
 * the enclosing function was CCN 33 against a block threshold of 10).
 */
async function classifyRateLimitResponse(response) {
  let quotaType = '';
  try {
    const body = await response.json();
    if (body && body.error && body.error.type === 'budget_exceeded') {
      quotaType = body.error.param === 'cost_quota' ? 'daily budget exhausted' : 'quota not configured';
    }
  } catch {
    // body is not JSON; fall through to the generic rate-limit handling
  }
  if (quotaType) {
    return { error: true, retryable: false, message: `WhaleCloud budget_exceeded: ${quotaType} for this model.` };
  }
  return { error: true, retryable: true, message: 'Rate limit exceeded (429).' };
}

/**
 * Map a 5xx to a verdict, reading the provider's structured error body the same
 * way the 429 branch does instead of discarding it (#705).
 *
 * Measured on the whalecloud gateway: a prompt containing
 * `new ProcessBuilder(args).start()` makes the gateway fail in its
 * response-processing stage and return 500 with
 *   {"error":{"type":"response_processing_error",
 *             "param":"non_stream_chat_response","code":"500"}}
 * The old code threw that away and reported "Server error (500).", which reads
 * as a transient outage. `type`/`param` are what tell an operator apart gateway
 * flapping vs. upstream timeout vs. content-triggered processing failure —
 * three problems with three different responses.
 *
 * Retryability is the other half: a content-dependent failure cannot clear by
 * retrying (the content did not change), so marking it retryable burns the
 * orchestrator's retry budget on a guaranteed repeat. Only an explicitly
 * recognised response_processing_error is demoted; every other 5xx keeps the
 * previous retryable=true, and an unparseable body keeps the previous behaviour
 * entirely — reading the body must not change the verdict on its own.
 */
async function classifyServerErrorResponse(response) {
  let detail = '';
  let processingError = false;
  try {
    const body = await response.json();
    if (body && body.error && typeof body.error === 'object') {
      const type = typeof body.error.type === 'string' ? body.error.type : '';
      const param = typeof body.error.param === 'string' ? body.error.param : '';
      if (type === 'response_processing_error') {
        processingError = true;
      }
      const parts = [type, param].filter(Boolean);
      if (parts.length > 0) {
        detail = ` Provider reported: ${parts.join('/')}.`;
      }
    }
  } catch {
    // body is not JSON; keep the previous behaviour untouched
  }
  if (processingError) {
    return {
      error: true,
      retryable: false,
      message: `Server error (${response.status}).${detail} This is a content-dependent upstream processing failure, so retrying the same prompt will fail the same way.`,
    };
  }
  return { error: true, retryable: true, message: `Server error (${response.status}).${detail}` };
}

/**
 * Map a 2xx response body to a verdict.
 *
 * The gateway must echo which model actually served the request. Writing `null`
 * here used to be tolerated downstream, which let a run that never resolved a
 * model count as a successful expert call (#423). Fail at the source instead,
 * so the evidence never records an unverifiable expert.
 */
async function readSuccessfulResponse(response) {
  const data = await response.json();
  if (!isPlainObject(data) || !Array.isArray(data.choices)) {
    return { error: true, message: 'Invalid response from model.' };
  }
  const firstChoice = data.choices[0];
  const message = isPlainObject(firstChoice) ? firstChoice.message : null;
  const content = isPlainObject(message) ? message.content : null;
  if (typeof content !== 'string' || content.trim() === '') {
    return { error: true, message: 'Invalid response from model.' };
  }

  const resolvedModel = typeof data.model === 'string' ? data.model.trim() : '';
  if (resolvedModel === '') {
    return {
      error: true,
      message: 'Gateway response did not include a resolved model id; cannot prove which model ran.',
    };
  }

  return {
    success: true,
    content: content.trim(),
    resolved_model: resolvedModel,
  };
}

/**
 * Build the request body. `temperature: 0.3` is a Delphi-review choice: low
 * enough to keep verdicts reproducible, non-zero so three experts on the same
 * model are not literally identical runs.
 */
function buildChatBody(model, systemPrompt, userPrompt) {
  return {
    model: model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.3,
    response_format: { type: 'json_object' },
  };
}

/**
 * Turn an HTTP response into the runner's result shape.
 *
 * The status ladder lived inline in `callModelAPI` (58 lines, over the bound).
 * It is a policy about which failures are worth retrying and which need the
 * operator -- 401/403 is a key problem the code cannot fix, 429 and 5xx may pass
 * on their own, and anything else is reported without echoing the provider body.
 *
 * @param {Response} response
 * @returns {Promise<object>}
 */
async function classifyHttpResponse(response) {
  if (response.status === 401 || response.status === 403) {
    return { error: true, message: `Authentication failed (${response.status}). Check API key in .delphi-config.json.` };
  }
  if (response.status === 429) {
    return await classifyRateLimitResponse(response);
  }
  if (response.status >= 500) {
    return await classifyServerErrorResponse(response);
  }
  if (!response.ok) {
    return { error: true, message: `API request failed (${response.status}). Provider response was not included.` };
  }
  return await readSuccessfulResponse(response);
}

async function callModelAPI(providerConfig, model, systemPrompt, userPrompt, options = {}) {
  const url = `${providerConfig.base_url.replace(/\/$/, '')}/chat/completions`;
  const body = buildChatBody(model, systemPrompt, userPrompt);

  // Same constant as the runner default: a second literal here silently
  // diverges whenever the default is retuned (#429).
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let responseReceived = false;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${providerConfig.api_key}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    responseReceived = true;

    return await classifyHttpResponse(response);
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { error: true, retryable: true, message: `Request timed out (${timeoutMs}ms). Raise --timeout-ms or the provider's timeout_ms.` };
    }
    if (responseReceived) {
      return { error: true, message: 'Invalid response from model.' };
    }
    // Deliberately do NOT surface the underlying cause here. Provider errors can
    // carry mutable metadata (tokens, keys, hostnames) that must not leak into the
    // evidence file; the test suite asserts this redaction. The structured
    // `error_kind` is what classifySeatFailure keys on — matching the human
    // message would make every future wording change silently disable the
    // size-ceiling classification (#414 R1 FC-01).
    return { error: true, error_kind: 'pre_response_drop', message: 'Network error.' };
  } finally {
    clearTimeout(timeout);
  }
}


function parseExpertVerdict(value) {
  if (!isPlainObject(value)) return { valid: false, message: 'Invalid expert verdict.' };
  const verdicts = ['APPROVED', 'REQUEST_CHANGES', 'REJECTED'];
  if (!verdicts.includes(value.verdict)) return { valid: false, message: 'Invalid expert verdict.' };
  if (!Number.isFinite(value.confidence) || value.confidence < 1 || value.confidence > 10) {
    return { valid: false, message: 'Invalid expert verdict.' };
  }
  for (const field of ['critical_issues', 'major_concerns', 'minor_concerns']) {
    if (!Array.isArray(value[field]) || !value[field].every(item => typeof item === 'string')) {
      return { valid: false, message: 'Invalid expert verdict.' };
    }
  }
  if (typeof value.summary !== 'string') return { valid: false, message: 'Invalid expert verdict.' };
  return {
    valid: true,
    verdict: {
      verdict: value.verdict,
      confidence: value.confidence,
      critical_issues: value.critical_issues,
      major_concerns: value.major_concerns,
      minor_concerns: value.minor_concerns,
      summary: value.summary,
    },
  };
}

function buildReviewOutput(verdict, args, provenance) {
  const parsed = parseExpertVerdict(verdict);
  const output = {
    expert_id: { architecture: 'A', technical: 'B', feasibility: 'C' }[args.expert],
    expert_role: args.expert,
    model_used: `${provenance.provider}/${provenance.requested_model}`,
    requested_model: provenance.requested_model,
    resolved_model: provenance.resolved_model,
    // Provenance marker required by Gate MW (#423). This script talks to an
    // external gateway, so every record it emits is `external`. The field is
    // explicit rather than inferred: the validator rejects a missing value
    // instead of defaulting it, which is what makes forgery costly.
    channel: provenance.channel,
    round: args.round,
    mode: args.mode,
  };
  if (!parsed.valid) {
    return { ...output, result_type: 'delphi_expert_error', error: true, message: parsed.message };
  }
  return { ...parsed.verdict, ...output, result_type: 'delphi_expert_result' };
}

// ── Retry logic ────────────────────────────────────────────────────────
/** The first retry waits this long; each subsequent one doubles it. */
const RETRY_BASE_DELAY_MS = 1000;

/** Wait `ms` without blocking the event loop. */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Announce and take the back-off before retry number `attempt`.
 *
 * Exponential from a named base: 1 s, 2 s, 4 s. The wait is ANNOUNCED first, because a
 * silent two-second pause reads as a hang, and the operator's next move (wait, or kill
 * it) depends on knowing a retry is in progress.
 *
 * @param {number} attempt zero-based retry index
 * @param {string} reason why the previous call is being retried
 */
async function backOffBeforeRetry(attempt, reason) {
  const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
  console.error(`[delphi-review] Retryable error: ${reason}. Retrying in ${delay}ms...`);
  await sleep(delay);
}

/**
 * Call the model, retrying only the failures worth retrying.
 *
 * `retryable` is the PROVIDER's answer, not ours: a configuration error retried three
 * times just wastes three timeouts, and the caller needs the first failure reported
 * rather than the last one's symptoms.
 */
async function callWithRetry(providerConfig, model, systemPrompt, userPrompt, maxRetries = 2, timeoutMs = DEFAULT_TIMEOUT_MS) {
  let lastResult;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await callModelAPI(providerConfig, model, systemPrompt, userPrompt, { timeoutMs });

    if (result.success) return result;
    if (!result.retryable) return result;

    lastResult = result;
    if (attempt < maxRetries) await backOffBeforeRetry(attempt, result.message);
  }
  return lastResult;
}

/**
 * Read a file if it exists, else return null. Optional context, so a read failure
 * is not fatal -- but it must not throw either.
 *
 * @param {string|undefined} filePath
 * @returns {string|null}
 */
function readOptionalFile(filePath) {
  if (!filePath) return null;
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    // The caller asked for optional context; an unreadable file means there is
    // none, not that the review should abort.
    return null;
  }
}

/**
 * Validate the expert map, then hand back the requested seat and its provider.
 *
 * Extracted from `main` (123 lines). The validation runs BEFORE the lookup on
 * purpose: a duplicate-model config should be reported as that, not as "expert
 * not found" because the seat it names happens to be the one that was shadowed.
 *
 * @param {object} config
 * @param {string} expertName
 * @returns {{expertConfig: object, provider: object}}
 */
function resolveSeat(config, expertName) {
  const validation = validateDistinctModels(config.experts, config.providers, config.consensus);
  if (!validation.valid) {
    console.error(`[delphi-review] ERROR: ${validation.reason}`);
    process.exit(1);
  }
  if (validation.warning) {
    console.error(`[delphi-review] WARNING: ${validation.warning}`);
  }
  for (const warning of config.warnings) {
    console.error(`[delphi-review] WARNING: ${warning}`);
  }

  const expertConfig = config.experts[expertName];
  if (!expertConfig) {
    console.error(`[delphi-review] ERROR: Expert "${expertName}" not found in config.`);
    process.exit(1);
  }
  const provider = config.providers[expertConfig.provider];
  if (!provider) {
    console.error(`[delphi-review] ERROR: Provider "${expertConfig.provider}" not found in config.`);
    process.exit(1);
  }
  return { expertConfig, provider };
}

/**
 * Shape the JSON a failed seat reports.
 *
 * Pure: everything it needs is an argument. The `bytes` fields are attached only
 * when classification produced them, because a null byte count reads as a real
 * measurement of zero.
 *
 * @param {object} outcome
 * @param {string} expertName
 * @param {{bytes: number}} budget
 * @param {object} seatCalibration
 * @returns {object}
 */
function buildErrorOutput(outcome, expertName, budget, seatCalibration) {
  const classified = classifySeatFailure({
    result: outcome,
    promptBytes: budget.bytes,
    calibration: seatCalibration.calibration,
  });
  const errorOutput = {
    error: true,
    error_type: classified.error_type,
    expert_role: expertName,
    message: classified.message,
    retryable: classified.retryable || false,
  };
  if (classified.bytes !== undefined) {
    errorOutput.bytes = classified.bytes;
    errorOutput.calibrated_pass_bytes = classified.calibrated_pass_bytes;
  }
  return errorOutput;
}

/**
 * Build the prompts and refuse the call if they exceed the prompt budget.
 *
 * The refusal happens BEFORE the request, not after the gateway kills it, and it
 * writes the same JSON stdout contract as an API failure: an orchestrator reading
 * that stream has to be able to tell "we never asked" from "the model answered
 * wrongly". `resolveSeatCalibration` prints its own warning, so it is not echoed
 * here (#414 R1 MN-03).
 *
 * @param {object} args
 * @param {object} expertConfig
 * @returns {{systemPrompt: string, userPrompt: string, budget: object, seatCalibration: object}}
 */
function preparePrompt(args, expertConfig) {
  const reviewContent = resolveInputContent(args);
  const otherExpertsContent = readOptionalFile(args.otherExpertsFile);

  const systemPrompt = buildSystemPrompt(args.expert, args.mode);
  const userPrompt = buildUserPrompt(reviewContent, otherExpertsContent, args.round);

  const seatCalibration = resolveSeatCalibration(expertConfig);
  const budget = checkPromptBudget({
    systemPrompt,
    userPrompt,
    maxBytes: resolvePromptBudgetBytes(expertConfig),
  });
  if (!budget.ok) {
    const message = describePromptBudgetFailure({ ...budget, expert: args.expert });
    console.error(`[delphi-review] ERROR: ${message}`);
    console.log(JSON.stringify({
      error: true,
      error_type: 'prompt_budget_exceeded',
      expert_role: args.expert,
      message,
      bytes: budget.bytes,
      max_bytes: budget.maxBytes,
      retryable: false,
    }));
    process.exit(1);
  }
  return { systemPrompt, userPrompt, budget, seatCalibration };
}

// ── Main execution ─────────────────────────────────────────────────────
async function main() {
  checkNodeVersion();

  const args = parseArgs(process.argv.slice(2));
  const config = readConfig(args.config, args.profile);

  const { expertConfig, provider } = resolveSeat(config, args.expert);

  const { systemPrompt, userPrompt, budget, seatCalibration } = preparePrompt(args, expertConfig);

  // Call API with retry; one schema-restating retry recovers malformed JSON
  // without ever faking a verdict (#414 REQ-5).
  const timeoutMs = resolveTimeoutMs(args, provider);
  const outcome = await callExpertWithSchemaRetry({
    provider,
    model: expertConfig.model,
    systemPrompt,
    userPrompt,
    timeoutMs,
  });

  if (outcome.error) {
    console.log(JSON.stringify(buildErrorOutput(outcome, args.expert, budget, seatCalibration)));
    process.exit(1);
  }

  // Extract JSON from response (already parsed-and-validated, possibly after
  // one schema retry — the retry is surfaced so the evidence is never silent).
  if (outcome.retry === 1) {
    console.error('[delphi-review] WARNING: first response was not a valid verdict; accepted after one schema retry (retry:1).');
  }

  // Enrich output
  const output = buildReviewOutput(outcome.verdict, args, {
    provider: expertConfig.provider,
    requested_model: expertConfig.model,
    resolved_model: outcome.resolved_model,
    // This runner only ever reaches an external provider; local/offline
    // fallbacks are recorded by a different path (#423).
    channel: 'external',
  });

  console.log(JSON.stringify(output, null, 2));
  if (output.error) process.exit(1);
}

// ── Module exports (for testing) ───────────────────────────────────────
if (require.main !== module) {
  module.exports = {
    parseArgs,
    readConfig,
    expandEnvPlaceholder,
    clampConsensusSetting,
    globalConfigPath,
    validateDistinctModels,
    extractJsonFromResponse,
    buildSystemPrompt,
    buildUserPrompt,
    resolveInputContent,
    resolveTimeoutMs,
    DEFAULT_TIMEOUT_MS,
    resolvePromptBudgetBytes,
    checkPromptBudget,
    describePromptBudgetFailure,
    DEFAULT_PROMPT_BUDGET_BYTES,
    resolveSeatCalibration,
    classifySeatFailure,
    callExpertWithSchemaRetry,
    SCHEMA_RESTATEMENT,
    checkNodeVersion,
    callModelAPI,
    callWithRetry,
    parseExpertVerdict,
    buildReviewOutput,
  };
} else {
  main().catch(err => {
    console.error(`[delphi-review] FATAL: ${err.message}`);
    process.exit(1);
  });
}

/**
 * Machine-wide `.delphi-config.json` path: `$XDG_CONFIG_HOME/xp-gate/`, or
 * `~/.config/xp-gate/` when the variable is unset.
 *
 * Exported so the path-parity test can hold this loader, the Gate MW validator
 * and the DSH plugin to one definition instead of three restatements.
 *
 * Deliberately declared at the END of the file. Function declarations hoist, so
 * readConfig above can call it, but placing it here keeps every line before the
 * old EOF byte-identical — which matters because `.ccn-baseline.json` anchors
 * anonymous functions by line number (`file::(anonymous)@657`). Adding these
 * lines near the top shifted that anchor to 676 and Gate 3 then read a
 * pre-existing CCN=24 function as a brand-new violation.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {string}
 */
function globalConfigPath(env) {
  const configHome = env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(configHome, 'xp-gate', '.delphi-config.json');
}
