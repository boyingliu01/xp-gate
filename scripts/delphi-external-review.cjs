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
function isValidTimeoutMs(value) {
  return Number.isInteger(value) && value >= 1000 && value <= 600000;
}

function parseArgs(argv) {
  const args = {};
  let timeoutMsRaw;
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--expert': args.expert = argv[++i]; break;
      case '--input': args.input = argv[++i]; break;
      case '--input-file': args.inputFile = argv[++i]; break;
      case '--round': args.round = parseInt(argv[++i]); break;
      case '--config': args.config = argv[++i]; break;
      case '--mode': args.mode = argv[++i]; break;
      case '--profile': args.profile = argv[++i]; break;
      case '--other-experts-file': args.otherExpertsFile = argv[++i]; break;
      case '--timeout-ms': timeoutMsRaw = argv[++i]; break;
      case '--fallback-local': args.fallbackLocal = true; break;
      default: break;
    }
  }

  // Validate required args
  const missing = [];
  if (!args.expert) missing.push('--expert');
  if (!args.input && !args.inputFile) missing.push('--input or --input-file');
  if (!args.round) missing.push('--round');
  if (!args.config) missing.push('--config');

  if (missing.length > 0) {
    console.error(`[delphi-review] ERROR: Missing required arguments: ${missing.join(', ')}`);
    process.exit(1);
  }

  // Validate expert role
  if (!VALID_EXPERTS.includes(args.expert)) {
    console.error(`[delphi-review] ERROR: Invalid expert role "${args.expert}". Must be one of: ${VALID_EXPERTS.join(', ')}`);
    process.exit(1);
  }

  // Validate mutual exclusivity of --input and --input-file
  if (args.input && args.inputFile) {
    console.error('[delphi-review] ERROR: --input and --input-file are mutually exclusive. Use only one.');
    process.exit(1);
  }

  // Validate --timeout-ms: integer within [1000, 600000]
  if (timeoutMsRaw !== undefined) {
    const parsed = /^\d+$/.test(timeoutMsRaw) ? Number(timeoutMsRaw) : NaN;
    if (!isValidTimeoutMs(parsed)) {
      console.error('[delphi-review] ERROR: --timeout-ms must be an integer between 1000 and 600000.');
      process.exit(1);
    }
    args.timeoutMs = parsed;
  }

  // Defaults
  if (!args.mode) args.mode = 'design';
  if (!VALID_MODES.includes(args.mode)) {
    console.error(`[delphi-review] ERROR: Invalid mode "${args.mode}". Must be one of: ${VALID_MODES.join(', ')}`);
    process.exit(1);
  }

  return args;
}

// ── Config reading ─────────────────────────────────────────────────────
function readConfig(configPath, profileOverride) {
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

  const profileName = profileOverride || raw.active_profile || 'default';
  const profile = raw.profiles?.[profileName];

  if (!profile) {
    console.error(`[delphi-review] ERROR: Profile "${profileName}" not found in config.`);
    console.error(`[delphi-review] Available profiles: ${Object.keys(raw.profiles || {}).join(', ')}`);
    process.exit(1);
  }

  // Resolve ${ENV_VAR} references in provider api_key fields
  const providers = profile.providers || {};
  for (const [name, prov] of Object.entries(providers)) {
    if (prov.api_key && prov.api_key.startsWith('${') && prov.api_key.endsWith('}')) {
      const envName = prov.api_key.slice(2, -1);
      const envVal = process.env[envName];
      if (envVal) {
        prov.api_key = envVal;
      } else {
        console.error(`[delphi-review] WARNING: Environment variable ${envName} not set (provider: ${name}). API calls will fail.`);
      }
    }
  }

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
  const configuredThreshold = raw.consensus?.threshold_percent;
  const thresholdPercent = typeof configuredThreshold === 'number' && Number.isFinite(configuredThreshold)
    ? Math.max(90, configuredThreshold)
    : 90;
  if (configuredThreshold !== undefined && configuredThreshold !== thresholdPercent) {
    warnings.push('threshold_percent_clamped');
  }
  const configuredRounds = raw.consensus?.max_review_rounds;
  const maxReviewRounds = typeof configuredRounds === 'number' && Number.isFinite(configuredRounds)
    ? Math.min(5, Math.max(1, Math.trunc(configuredRounds)))
    : 5;
  if (configuredRounds !== undefined && configuredRounds !== maxReviewRounds) {
    warnings.push('max_review_rounds_clamped');
  }

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

// ── Distinct-model validation ───────────────────────────────────────────
const REQUIRED_EXPERT_ROLES = ['architecture', 'technical', 'feasibility'];

function validateDistinctModels(experts, providers, consensus = {}) {
  const expertMap = experts && typeof experts === 'object' ? experts : {};
  const providerMap = providers && typeof providers === 'object' ? providers : {};
  const expertRoles = Object.keys(expertMap);
  const normalizedModels = [];

  for (const role of REQUIRED_EXPERT_ROLES) {
    const expert = expertRoles.includes(role) ? expertMap[role] : undefined;
    if (!expert) {
      return { valid: false, reason: `Missing required expert role: ${role}.` };
    }
    if (typeof expert.model !== 'string' || expert.model.trim() === '') {
      return { valid: false, reason: `Expert ${role} must define a non-empty model.` };
    }
    normalizedModels.push({ role, model: expert.model.trim() });
  }

  const unexpectedRole = expertRoles.find(role => !REQUIRED_EXPERT_ROLES.includes(role));
  if (unexpectedRole) {
    return { valid: false, reason: `Unsupported expert role: ${unexpectedRole}.` };
  }

  const seen = new Map();
  for (const assignment of normalizedModels) {
    const previousRole = seen.get(assignment.model);
    if (previousRole) {
      return {
        valid: false,
        reason: `duplicate model "${assignment.model}" assigned to ${previousRole} and ${assignment.role}.`,
      };
    }
    seen.set(assignment.model, assignment.role);
  }

  for (const role of REQUIRED_EXPERT_ROLES) {
    const expert = expertMap[role];
    if (typeof expert.provider !== 'string' || expert.provider.trim() === '' || expert.provider === 'local') {
      return { valid: false, reason: `Expert ${role} must define a non-local callable provider.` };
    }
    const provider = providerMap[expert.provider];
    if (!provider || typeof provider !== 'object' || Array.isArray(provider)) {
      return { valid: false, reason: `Expert ${role} provider configuration must be an object.` };
    }
    if (typeof provider.base_url !== 'string' || provider.base_url.trim() === '') {
      return { valid: false, reason: `Expert ${role} provider must define a non-empty base_url.` };
    }
    if (typeof provider.api_key !== 'string' || provider.api_key.trim() === '') {
      return { valid: false, reason: `Expert ${role} provider must define a non-empty api_key.` };
    }
    if (provider.timeout_ms !== undefined && !isValidTimeoutMs(provider.timeout_ms)) {
      return {
        valid: false,
        reason: `Expert ${role} provider ${expert.provider} timeout_ms must be an integer between 1000 and 600000.`,
      };
    }
  }

  if (consensus.cross_provider_required === true) {
    return {
      valid: true,
      warning: 'cross_provider_required_ignored',
    };
  }

  return { valid: true };
}

// ── JSON extraction (4-layer fallback) ─────────────────────────────────
function extractJsonFromResponse(content) {
  if (!content || typeof content !== 'string') {
    return { parse_error: true, raw_content: String(content || '') };
  }

  const trimmed = content.trim();

  // Layer 1: Direct parse
  try {
    return JSON.parse(trimmed);
  } catch { /* continue */ }

  // Layer 2: Strip markdown code block
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch { /* continue */ }
  }

  // Layer 3: Extract first JSON object
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch { /* continue */ }
  }

  // Layer 4: Fallback
  return { parse_error: true, raw_content: trimmed };
}

// ── System prompt templates ────────────────────────────────────────────
const SYSTEM_PROMPTS = {
  architecture: `你是架构评审专家（Delphi Method - Architecture Expert）。

你的评审关注维度：
1) 需求对齐度 — 设计是否完整覆盖所有需求
2) 系统一致性 — 与现有架构风格、模式是否一致
3) 模块边界清晰度 — 职责划分是否明确，耦合度是否合理
4) 架构演进性 — 是否为未来扩展留有空间
5) 技术选型合理性 — 技术栈选择是否有充分依据

输出要求：返回结构化 JSON，包含 verdict (APPROVED/REQUEST_CHANGES/REJECTED)、confidence (1-10，整数，10 为最高)、summary (字符串)。critical_issues、major_concerns、minor_concerns 必须是字符串数组（string[]），每项是一句自包含的完整描述（可加 "CI-01: " 前缀，但整体必须是字符串，不是对象）。不要把问题写成 {id, title, description} 对象。`,

  technical: `你是技术实现评审专家（Delphi Method - Technical Expert）。

你的评审关注维度：
1) 实现正确性 — 逻辑是否正确，边界条件是否处理
2) 代码质量和设计模式 — 是否遵循 SOLID 原则，代码是否清晰
3) 边界情况和错误处理 — 异常路径是否覆盖，错误处理是否健壮
4) 性能影响 — 是否有性能瓶颈或资源泄漏风险
5) 可测试性 — 代码是否易于编写单元测试

输出要求：返回结构化 JSON，包含 verdict (APPROVED/REQUEST_CHANGES/REJECTED)、confidence (1-10，整数，10 为最高)、summary (字符串)。critical_issues、major_concerns、minor_concerns 必须是字符串数组（string[]），每项是一句自包含的完整描述（可加 "MC-01: " 前缀，但整体必须是字符串，不是对象）。不要把问题写成 {id, title, description} 对象。`,

  feasibility: `你是可行性分析专家（Delphi Method - Feasibility Expert）。

你的评审关注维度：
1) 实际约束（时间/资源/依赖）— 是否在现有约束下可行
2) 风险识别和缓解 — 主要风险是否已识别，缓解措施是否充分
3) 执行复杂度 — 实现难度是否被低估，依赖链是否清晰
4) 替代方案 — 是否有更简单或更可靠的替代方案
5) 回滚策略 — 如果实施失败，是否有退路

输出要求：返回结构化 JSON，包含 verdict (APPROVED/REQUEST_CHANGES/REJECTED)、confidence (1-10，整数，10 为最高)、summary (字符串)。critical_issues、major_concerns、minor_concerns 必须是字符串数组（string[]），每项是一句自包含的完整描述（可加 "FC-01: " 前缀，但整体必须是字符串，不是对象）。不要把问题写成 {id, title, description} 对象。`,
};

const MODE_FOCUS_PROMPTS = {
  design: '',
  'code-walkthrough': '\n\n本次评审聚焦已实现代码的正确性、风险和可验证结果。',
  requirements: '\n\n本次评审聚焦需求陈述的完整性、一致性、可验收性和约束清晰度。',
};

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
    if (!fs.existsSync(args.inputFile)) {
      console.error(`[delphi-review] ERROR: Input file not found: ${args.inputFile}`);
      process.exit(1);
    }
    return fs.readFileSync(args.inputFile, 'utf8');
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
const DEFAULT_PROMPT_BUDGET_BYTES = 40000;

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

// ── API call ───────────────────────────────────────────────────────────
async function callModelAPI(providerConfig, model, systemPrompt, userPrompt, options = {}) {
  const url = `${providerConfig.base_url.replace(/\/$/, '')}/chat/completions`;

  const body = {
    model: model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.3,
    response_format: { type: 'json_object' },
  };

  const timeoutMs = options.timeoutMs ?? 30000;
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

    if (response.status === 401 || response.status === 403) {
      return { error: true, message: `Authentication failed (${response.status}). Check API key in .delphi-config.json.` };
    }

    if (response.status === 429) {
      // A 429 is not always a transient rate limit. WhaleCloud returns 429 with
      // `type: "budget_exceeded"` in two distinct non-retryable cases, which a
      // blind retry cannot clear and would otherwise burn two round-trips before
      // failing:
      //   - `error.param === "category_quota"`: the account has no ECONOMY/STANDARD
      //     quota configured for the model ("需要专项额度...尚未配置") — needs an
      //     admin to add it.
      //   - `error.param === "cost_quota"`: the account's daily spending cap is
      //     exhausted ("今日额度已耗尽...限额: 100.00元") — resets the next day.
      // Surface which kind it is so the caller knows whether to wait or to request
      // an admin change, rather than treating both as a generic rate limit.
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

    if (response.status >= 500) {
      return { error: true, retryable: true, message: `Server error (${response.status}).` };
    }

    if (!response.ok) {
      return { error: true, message: `API request failed (${response.status}). Provider response was not included.` };
    }

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

    // The gateway must echo which model actually served the request. Writing
    // `null` here used to be tolerated downstream, which let a run that never
    // resolved a model count as a successful expert call (#423). Fail at the
    // source instead, so the evidence never records an unverifiable expert.
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
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { error: true, retryable: true, message: `Request timed out (${timeoutMs}ms). Raise --timeout-ms or the provider's timeout_ms.` };
    }
    if (responseReceived) {
      return { error: true, message: 'Invalid response from model.' };
    }
    // Deliberately do NOT surface the underlying cause here. Provider errors can
    // carry mutable metadata (tokens, keys, hostnames) that must not leak into the
    // evidence file; the test suite asserts this redaction. Keep the generic form.
    return { error: true, message: 'Network error.' };
  } finally {
    clearTimeout(timeout);
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
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
async function callWithRetry(providerConfig, model, systemPrompt, userPrompt, maxRetries = 2, timeoutMs = DEFAULT_TIMEOUT_MS) {
  let lastResult;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await callModelAPI(providerConfig, model, systemPrompt, userPrompt, { timeoutMs });

    if (result.success) return result;
    if (!result.retryable) return result;

    lastResult = result;
    if (attempt < maxRetries) {
      const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
      console.error(`[delphi-review] Retryable error: ${result.message}. Retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  return lastResult;
}

// ── Main execution ─────────────────────────────────────────────────────
async function main() {
  checkNodeVersion();

  const args = parseArgs(process.argv.slice(2));
  const config = readConfig(args.config, args.profile);

  // Validate the complete expert map before fallback or provider lookup.
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

  // Get expert config
  const expertConfig = config.experts[args.expert];
  if (!expertConfig) {
    console.error(`[delphi-review] ERROR: Expert "${args.expert}" not found in config.`);
    process.exit(1);
  }

  // Get provider config
  const provider = config.providers[expertConfig.provider];
  if (!provider) {
    console.error(`[delphi-review] ERROR: Provider "${expertConfig.provider}" not found in config.`);
    process.exit(1);
  }

  // Resolve input
  const reviewContent = resolveInputContent(args);

  // Resolve other experts context
  let otherExpertsContent = null;
  if (args.otherExpertsFile && fs.existsSync(args.otherExpertsFile)) {
    otherExpertsContent = fs.readFileSync(args.otherExpertsFile, 'utf8');
  }

  // Build prompts
  const systemPrompt = buildSystemPrompt(args.expert, args.mode);
  const userPrompt = buildUserPrompt(reviewContent, otherExpertsContent, args.round);

  // Refuse before the request, not after the gateway kills it.
  const budget = checkPromptBudget({
    systemPrompt,
    userPrompt,
    maxBytes: resolvePromptBudgetBytes(expertConfig),
  });
  if (!budget.ok) {
    const message = describePromptBudgetFailure({ ...budget, expert: args.expert });
    console.error(`[delphi-review] ERROR: ${message}`);
    // Same stdout contract as an API failure: an orchestrator parsing this stream
    // must be able to tell "we never asked" from "the model answered wrongly".
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

  // Call API with retry
  const timeoutMs = resolveTimeoutMs(args, provider);
  const result = await callWithRetry(provider, expertConfig.model, systemPrompt, userPrompt, 2, timeoutMs);

  if (result.error) {
    const errorOutput = {
      error: true,
      expert_role: args.expert,
      message: result.message,
      retryable: result.retryable || false,
    };
    console.log(JSON.stringify(errorOutput));
    process.exit(1);
  }

  // Extract JSON from response
  const verdict = extractJsonFromResponse(result.content);

  if (verdict.parse_error) {
    console.error(`[delphi-review] WARNING: Could not parse model response as JSON.`);
  }

  // Enrich output
  const output = buildReviewOutput(verdict, args, {
    provider: expertConfig.provider,
    requested_model: expertConfig.model,
    resolved_model: result.resolved_model,
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
    validateDistinctModels,
    extractJsonFromResponse,
    buildSystemPrompt,
    buildUserPrompt,
    resolveInputContent,
    resolveTimeoutMs,
    resolvePromptBudgetBytes,
    checkPromptBudget,
    describePromptBudgetFailure,
    DEFAULT_PROMPT_BUDGET_BYTES,
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
