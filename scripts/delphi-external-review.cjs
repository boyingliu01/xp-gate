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
const VALID_MODES = ['design', 'code-walkthrough'];

function parseArgs(argv) {
  const args = {};
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

  return {
    active_profile: profileName,
    providers,
    experts,
    consensus: {
      threshold_percent: 90,
      max_review_rounds: 5,
      ...(raw.consensus || {}),
      distinct_models_required: true,
    },
    warnings,
  };
}

// ── Distinct-model validation ───────────────────────────────────────────
const REQUIRED_EXPERT_ROLES = ['architecture', 'technical', 'feasibility'];

function validateDistinctModels(experts, _providers, consensus = {}) {
  const expertMap = experts && typeof experts === 'object' ? experts : {};
  const expertRoles = Object.keys(expertMap);
  const normalizedModels = [];

  for (const role of REQUIRED_EXPERT_ROLES) {
    const expert = expertRoles.includes(role) ? expertMap[role] : undefined;
    if (!expert) {
      return { valid: false, reason: `Missing required expert role: ${role}.` };
    }
    if (expert.provider === 'local') {
      return { valid: false, reason: `Expert ${role} requires a callable provider when distinct models are enforced.` };
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

  if (consensus.cross_provider_required === true) {
    return {
      valid: true,
      warning: 'cross_provider_required is deprecated and ignored; distinct model identifiers are enforced.',
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

输出要求：返回结构化 JSON，包含 verdict (APPROVED/REQUEST_CHANGES/REJECTED)、confidence (1-10)、critical_issues、major_concerns、minor_concerns、summary。`,

  technical: `你是技术实现评审专家（Delphi Method - Technical Expert）。

你的评审关注维度：
1) 实现正确性 — 逻辑是否正确，边界条件是否处理
2) 代码质量和设计模式 — 是否遵循 SOLID 原则，代码是否清晰
3) 边界情况和错误处理 — 异常路径是否覆盖，错误处理是否健壮
4) 性能影响 — 是否有性能瓶颈或资源泄漏风险
5) 可测试性 — 代码是否易于编写单元测试

输出要求：返回结构化 JSON，包含 verdict (APPROVED/REQUEST_CHANGES/REJECTED)、confidence (1-10)、critical_issues、major_concerns、minor_concerns、summary。`,

  feasibility: `你是可行性分析专家（Delphi Method - Feasibility Expert）。

你的评审关注维度：
1) 实际约束（时间/资源/依赖）— 是否在现有约束下可行
2) 风险识别和缓解 — 主要风险是否已识别，缓解措施是否充分
3) 执行复杂度 — 实现难度是否被低估，依赖链是否清晰
4) 替代方案 — 是否有更简单或更可靠的替代方案
5) 回滚策略 — 如果实施失败，是否有退路

输出要求：返回结构化 JSON，包含 verdict (APPROVED/REQUEST_CHANGES/REJECTED)、confidence (1-10)、critical_issues、major_concerns、minor_concerns、summary。`,
};

function buildSystemPrompt(role) {
  return SYSTEM_PROMPTS[role] || SYSTEM_PROMPTS.architecture;
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

// ── API call ───────────────────────────────────────────────────────────
async function callModelAPI(providerConfig, model, systemPrompt, userPrompt) {
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

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

    clearTimeout(timeout);

    if (response.status === 401 || response.status === 403) {
      return { error: true, message: `Authentication failed (${response.status}). Check API key in .delphi-config.json.` };
    }

    if (response.status === 429) {
      return { error: true, retryable: true, message: 'Rate limit exceeded (429).' };
    }

    if (response.status >= 500) {
      return { error: true, retryable: true, message: `Server error (${response.status}).` };
    }

    if (!response.ok) {
      return { error: true, message: `API request failed (${response.status}). Provider response was not included.` };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      return { error: true, message: 'Empty response from model.' };
    }

    return {
      success: true,
      content,
      resolved_model: typeof data.model === 'string' && data.model.trim() !== '' ? data.model.trim() : null,
    };
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      return { error: true, retryable: true, message: 'Request timed out (30s).' };
    }
    return { error: true, message: `Network error: ${err.message}` };
  }
}

function buildReviewOutput(verdict, args, provenance) {
  return {
    ...verdict,
    expert_id: { architecture: 'A', technical: 'B', feasibility: 'C' }[args.expert],
    expert_role: args.expert,
    model_used: `${provenance.provider}/${provenance.requested_model}`,
    requested_model: provenance.requested_model,
    resolved_model: provenance.resolved_model,
    round: args.round,
    mode: args.mode,
  };
}

// ── Retry logic ────────────────────────────────────────────────────────
async function callWithRetry(providerConfig, model, systemPrompt, userPrompt, maxRetries = 2) {
  let lastResult;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await callModelAPI(providerConfig, model, systemPrompt, userPrompt);

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
  const systemPrompt = buildSystemPrompt(args.expert);
  const userPrompt = buildUserPrompt(reviewContent, otherExpertsContent, args.round);

  // Call API with retry
  const result = await callWithRetry(provider, expertConfig.model, systemPrompt, userPrompt);

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
  });

  console.log(JSON.stringify(output, null, 2));
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
    checkNodeVersion,
    callModelAPI,
    callWithRetry,
    buildReviewOutput,
  };
} else {
  main().catch(err => {
    console.error(`[delphi-review] FATAL: ${err.message}`);
    process.exit(1);
  });
}
