/**
 * xp-gate phase-transition — Programmatic sprint phase transition
 *
 * Resolves #338 (dashboar auto-renders) and #146 (sprint-state enforcement).
 * 
 * This CLI command is the programmatic entry point for sprint phase transitions.
 * The sprint-flow SKILL.md MUST instruct the orchestrator to call this command
 * after each phase completion, replacing text-level MUST instructions with
 * a concrete CLI invocation.
 *
 * Usage:
 *   xp-gate phase-transition <phase> <status> [--outputs <json>] [--render]
 *
 * Examples:
 *   xp-gate phase-transition 1 completed
 *   xp-gate phase-transition 2 in_progress
 *   xp-gate phase-transition 3 completed --outputs '{"spec":"path/to/spec.yaml"}'
 *   xp-gate phase-transition 3 completed --render  (auto-render dashboard)
 *
 * @module phase-transition
 */

'use strict';

const path = require('path');
const { statusIcon, formatDuration: formatDurationShared } = require('./sprint-format.js');

/**
 * The dashboard renders an unmeasured duration as `-` so the column keeps its width;
 * a blank cell would make the table look ragged.
 *
 * @param {number|null|undefined} seconds
 * @returns {string}
 */
function formatDuration(seconds) {
  return formatDurationShared(seconds, { empty: '-' });
}
const fs = require('fs');
const crypto = require('crypto');
const { execFileSync, execSync } = require('child_process');
const { SprintStateManager } = require('./sprint-state-manager');

/**
 * Shared phase name lookup — single source of truth.
 * Used by renderDashboard, sprint-audit, and Layer 1 gate check.
 */
const PHASE_PREP = 1;
const PHASE_DESIGN = 2;
const PHASE_BUILD = 3;
const PHASE_VERIFY = 4;
const PHASE_SHIP = 5;
const PHASE_CLOSE = 6;
/** How many phases the pipeline has -- the denominator of the progress bar. */
const PHASE_COUNT = PHASE_CLOSE - PHASE_PREP + 1;
/** `YYYY-MM-DDTHH:MM` is 16 characters; the seconds are display noise. */
const DURATION_COLUMN_WIDTH = 8;
/**
 * Inner width of the dashboard's ASCII frame.
 *
 * Every `+===+` line is 60 characters wide, so the content area is 58 and a row
 * that starts after `|  ` gets 59. These are one design, not three numbers, and
 * naming them is what keeps the frame from going ragged.
 */
const FRAME_INNER_WIDTH = 58;
const FRAME_ROW_WIDTH = FRAME_INNER_WIDTH + 1;
/** `|  ` plus one more space before a wrapped field's text. */
const OUTPUT_ROW_INDENT = 3;
const TIMESTAMP_MINUTE_LENGTH = 16;

const PHASE_NAMES = {
  [PHASE_PREP]: 'PREP',
  [PHASE_DESIGN]: 'DESIGN',
  [PHASE_BUILD]: 'BUILD',
  [PHASE_VERIFY]: 'VERIFY',
  [PHASE_SHIP]: 'SHIP',
  [PHASE_CLOSE]: 'CLOSE',
};

/**
 * The review is exactly three experts, and consensus is 90% or better.
 *
 * Both numbers appear in several places and both are policy, not arithmetic: a
 * two-expert "Delphi review" is a different process, and a lower threshold makes
 * the verdict mean something else. Naming them lets the rule be read.
 */
const DELPHI_EXPERT_COUNT = 3;
const DELPHI_CONSENSUS_THRESHOLD = 0.9;

/**
 * Phase-specific evidence file requirements.
 * Each entry defines the evidence file path, required fields, and a blocking check.
 * Phases NOT in this map require no evidence validation in v0.17.1.
 */
const EVIDENCE_FILES = {
  2: {
    path: '.sprint-state/phase-outputs/requirements-reviewed.json',
    requiredFields: [
      'verdict', 'requirements_statement', 'timestamp', 'consensus_ratio',
      'expert_verdicts', 'head_commit', 'requirements_hash',
    ],
    blockingCheck: (data) => data.verdict === 'APPROVED',
    blockingMessage: 'Requirements review verdict is not APPROVED',
  },
  [PHASE_VERIFY]: {
    path: '.sprint-state/phase-outputs/test-alignment-report.json',
    requiredFields: ['alignment_status', 'head_commit', 'spec_hash'],
    blockingCheck: (data) => data.alignment_status === 'PASS',
    blockingMessage: 'Test alignment status is not PASS',
  },
};


/**
 * Get current HEAD commit hash from a project directory.
 * Returns null if HEAD cannot be resolved.
 * @param {string} projectDir
 * @returns {string | null}
 */
function getCurrentHeadCommit(projectDir) {
  try {
    return execSync('git rev-parse HEAD', {
      cwd: projectDir,
      env: createRepositoryGitEnv(),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

function validateRequirementsExpertEvidence(data) {
  const validationErrors = [];
  if (!Array.isArray(data.expert_verdicts) || data.expert_verdicts.length !== DELPHI_EXPERT_COUNT) {
    validationErrors.push('expert_verdicts must contain exactly 3 expert results');
    return validationErrors;
  }

  const expectedRoles = new Set(['architecture', 'technical', 'feasibility']);
  const roles = data.expert_verdicts.map(expert => expert?.role);
  if (roles.some(role => !expectedRoles.has(role)) || new Set(roles).size !== expectedRoles.size) {
    validationErrors.push('expert_verdicts roles must be exactly architecture, technical, and feasibility');
  }
  if (data.expert_verdicts.some(expert => expert?.verdict !== 'APPROVED')) {
    validationErrors.push('every expert verdict must be APPROVED');
  }
  if (data.expert_verdicts.some(expert => expert?.result_type !== 'delphi_expert_result')) {
    validationErrors.push('every expert result_type must be delphi_expert_result');
  }
  if (data.expert_verdicts.some(expert =>
    (expert?.error !== undefined && expert.error !== false && expert.error !== null)
    || (expert?.fallback !== undefined && expert.fallback !== false && expert.fallback !== null)
  )) {
    validationErrors.push('expert results must not contain an error or fallback marker');
  }

  const requestedModels = data.expert_verdicts.map(expert =>
    typeof expert?.requested_model === 'string' ? expert.requested_model.trim() : ''
  );
  if (requestedModels.some(model => model.length === 0)) {
    validationErrors.push('every requested_model must be a non-empty trimmed string');
  } else if (new Set(requestedModels).size !== requestedModels.length) {
    validationErrors.push('requested_model values must be distinct after trimming');
  }

  if (!Number.isFinite(data.consensus_ratio)
      || data.consensus_ratio < DELPHI_CONSENSUS_THRESHOLD || data.consensus_ratio > 1) {
    validationErrors.push('consensus_ratio must be a finite number from 0.90 through 1');
  }
  return validationErrors;
}

/**
 * Compute SHA-256 hash of a file's contents.
 * @param {string} filePath
 * @returns {string} hex digest
 */
/**
 * SHA-256 of a file's contents.
 *
 * A read failure must not look like a hash mismatch: "the spec changed" and "I
 * could not read the spec" send the operator to different places. Callers compare
 * this against a recorded hash, so an exception here surfaces as a crash rather
 * than as a silent "changed" verdict -- which is the right direction.
 *
 * @param {string} filePath
 * @returns {string}
 */
function computeFileHash(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new Error(`cannot hash ${filePath}: ${err.message}`);
  }
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

function parseEvidenceDate(timestamp) {
  if (typeof timestamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(timestamp)) {
    return null;
  }
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== timestamp.slice(0, 10)) {
    return null;
  }
  return timestamp.slice(0, 10);
}

/** One message for every way a `context_file_used` path can be unusable. */
const UNSAFE_CONTEXT_PATH = 'context_file_used must be a safe project-relative regular file path';

function readRequirementsContext(data, projectDir) {
  const contextFile = data.context_file_used;
  if (contextFile === null || contextFile === undefined || contextFile === '') {
    return { content: '' };
  }
  if (typeof contextFile !== 'string' || path.isAbsolute(contextFile)) {
    return { error: UNSAFE_CONTEXT_PATH };
  }

  // Three stat/read calls can each fail, and every failure means the same thing:
  // the path is not a usable project-relative file. Reporting them as one error
  // keeps the traversal guard's verdict uniform rather than leaking a raw EACCES.
  try {
    const projectRoot = fs.realpathSync(projectDir);
    const candidatePath = path.resolve(projectRoot, contextFile);
    const relativeCandidate = path.relative(projectRoot, candidatePath);
    if (relativeCandidate.startsWith('..') || path.isAbsolute(relativeCandidate) || !fs.existsSync(candidatePath)) {
      return { error: UNSAFE_CONTEXT_PATH };
    }

    const realContextPath = fs.realpathSync(candidatePath);
    const relativeRealPath = path.relative(projectRoot, realContextPath);
    if (relativeRealPath.startsWith('..') || path.isAbsolute(relativeRealPath) || !fs.statSync(realContextPath).isFile()) {
      return { error: UNSAFE_CONTEXT_PATH };
    }
    return { content: fs.readFileSync(realContextPath, 'utf8') };
  } catch {
    return { error: UNSAFE_CONTEXT_PATH };
  }
}

function computeRequirementsHash(data, projectDir) {
  if (typeof data.requirements_statement !== 'string') {
    return { error: 'requirements_statement must be a string' };
  }
  const evidenceDate = parseEvidenceDate(data.timestamp);
  if (evidenceDate === null) {
    return { error: 'timestamp must be a valid UTC ISO-8601 timestamp' };
  }

  let context;
  try {
    context = readRequirementsContext(data, projectDir);
  } catch {
    return { error: 'context_file_used must be a safe project-relative regular file path' };
  }
  if (context.error) {
    return context;
  }
  return {
    hash: crypto.createHash('sha256')
      .update(`${data.requirements_statement}${context.content}${evidenceDate}`, 'utf8')
      .digest('hex'),
  };
}

/**
 * Validate phase evidence files for a given phase transition.
 *
 * Returns { ok: boolean, errors: string[], warnings: string[] }.
 * - For phases not in EVIDENCE_FILES: ok=true, no errors.
 * - For phases with evidence requirements:
 *   - If evidence_schema_version >= 2 (new sprint): missing/invalid evidence → ok=false (BLOCK)
 *   - If evidence_schema_version missing or < 2 (legacy sprint): missing/invalid → ok=true with WARNING
 *
 * @param {number} phase - Phase number (1-6)
 * @param {string} projectDir - Project root directory
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
/**
 * Record a validation problem where its severity depends on the sprint's schema.
 *
 * This decision was written out a dozen times inside `validateEvidence`, each copy
 * repeating the same full warning sentence. A sprint created before
 * `evidence_schema_version` 2 gets a WARNING: enforcing a rule the sprint was
 * never created under would block work that is not at fault.
 *
 * Mutates the arrays rather than returning new ones, because every call site
 * keeps pushing into the same `errors`/`warnings` afterwards -- handing back
 * copies silently dropped the later entries (measured: five tests failed).
 *
 * @param {string} msg
 * @param {string[]} errors
 * @param {string[]} warnings
 * @param {boolean} isLegacySprint
 * @returns {boolean} true when the problem was downgraded to a warning
 */
function recordProblem(msg, errors, warnings, isLegacySprint) {
  if (isLegacySprint) {
    warnings.push(`WARNING: ${msg}. Upgrade sprint with evidence_schema_version >= 2 to enforce.`);
    return true;
  }
  errors.push(msg);
  return false;
}

/**
 * The evidence schema version this sprint was created under, or 0.
 *
 * A sprint predating `evidence_schema_version` is treated as legacy (0), and
 * legacy sprints get WARNINGS where current ones get ERRORS. Unreadable state
 * therefore degrades to "even more lenient", which is the safe direction: a
 * corrupted state file must not start BLOCKING phase transitions that ran fine
 * yesterday.
 *
 * @param {string} projectDir
 * @returns {number}
 */
function readEvidenceSchemaVersion(projectDir) {
  try {
    const manager = new SprintStateManager(projectDir);
    const state = manager.read();
    if (state && typeof state.evidence_schema_version === 'number') {
      return state.evidence_schema_version;
    }
  } catch {
    // Unreadable state is not a versioned sprint.
  }
  return 0;
}

/**
 * Read and parse the evidence file, or produce the verdict that ends validation.
 *
 * Three failures share one shape: record the problem, then either pass (legacy
 * sprint, where the rule was not in force) or fail. They differ only in the
 * message and in whether the failing messages list is replaced, which is why the
 * third case reports `errors: [msg]` rather than the accumulated array.
 *
 * Returns `{ verdict }` when validation should stop, `{ data }` otherwise -- a
 * single exit point per outcome, so the caller keeps one shape.
 *
 * @param {string} evidenceFilePath
 * @param {string} configuredPath
 * @param {string[]} errors
 * @param {string[]} warnings
 * @param {boolean} isLegacySprint
 * @returns {{verdict?: object, data?: object}}
 */
function loadEvidence(evidenceFilePath, configuredPath, errors, warnings, isLegacySprint) {
  const fileName = path.basename(configuredPath);

  if (!fs.existsSync(evidenceFilePath)) {
    const msg = `Evidence file missing: ${configuredPath}`;
    if (recordProblem(msg, errors, warnings, isLegacySprint)) {
      return { verdict: { ok: true, errors: [], warnings } };
    }
    return { verdict: { ok: false, errors, warnings } };
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(evidenceFilePath, 'utf8'));
  } catch {
    const msg = `${fileName} is malformed JSON`;
    if (recordProblem(msg, errors, warnings, isLegacySprint)) {
      return { verdict: { ok: true, errors: [], warnings } };
    }
    return { verdict: { ok: false, errors, warnings } };
  }

  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    const msg = `${fileName} must contain a JSON object`;
    if (recordProblem(msg, errors, warnings, isLegacySprint)) {
      return { verdict: { ok: true, errors: [], warnings } };
    }
    return { verdict: { ok: false, errors: [msg], warnings } };
  }

  return { data };
}

/**
 * The evidence must describe the commit under review.
 *
 * Anti-staleness: a report generated before the last commit says nothing about
 * the code as it now stands. `currentHead === null` is reported separately -- "I
 * could not determine HEAD" and "HEAD moved" need different fixes, and collapsing
 * them would tell an operator to regenerate a report when the repository itself is
 * the problem.
 *
 * @param {string} fileName
 * @param {object} data
 * @param {string} projectDir
 * @param {string[]} errors
 * @param {string[]} warnings
 * @param {boolean} isLegacySprint
 */
function checkHeadCommit(fileName, data, projectDir, errors, warnings, isLegacySprint) {
  const currentHead = getCurrentHeadCommit(projectDir);
  if (currentHead === null) {
    const msg = `${fileName}: unable to resolve current Git HEAD; evidence identity cannot be verified`;
    recordProblem(msg, errors, warnings, isLegacySprint);
  } else if (data.head_commit !== currentHead) {
    const msg = `${fileName}: head_commit mismatch — report has "${data.head_commit}", current HEAD is "${currentHead}"`;
    recordProblem(msg, errors, warnings, isLegacySprint);
  }
}

/**
 * Anti-staleness checks specific to phases 2 and 4.
 *
 * Both phases review artifacts that are expensive to regenerate and cheap to let
 * rot: a spec hash, a requirements hash, the commit the review was written
 * against. Each check records rather than returns, so a report with several
 * staleness problems names all of them in one pass.
 *
 * Phase 2 does NOT re-check head_commit; the shared branch in the caller already
 * does, and it used to be checked twice.
 *
 * @param {number} phase
 * @param {string} fileName
 * @param {object} data
 * @param {string} projectDir
 * @param {string[]} errors
 * @param {string[]} warnings
 * @param {boolean} isLegacySprint
 */
function checkPhaseSpecificEvidence(phase, fileName, data, projectDir, errors, warnings, isLegacySprint) {
  // Phase-specific anti-staleness checks. Phase 2's head_commit is checked here
  // too, so the branch below must NOT check it again -- it used to, and a phase-2
  // report with a stale HEAD produced TWO warnings for one problem.
  if (phase === PHASE_DESIGN || phase === PHASE_VERIFY) {
    checkHeadCommit(fileName, data, projectDir, errors, warnings, isLegacySprint);
  }

  if (phase === PHASE_VERIFY) {
    // spec_hash check (only if specification.yaml exists)
    const specPath = path.join(projectDir, 'specification.yaml');
    if (fs.existsSync(specPath)) {
      const expectedHash = computeFileHash(specPath);
      if (data.spec_hash !== expectedHash) {
        const msg = `${fileName}: spec_hash mismatch — specification.yaml has changed since report was generated`;
        recordProblem(msg, errors, warnings, isLegacySprint);
      }
    }
  }

  if (phase === PHASE_DESIGN) {
    if (typeof data.requirements_hash !== 'string' || !/^[a-fA-F0-9]{64}$/.test(data.requirements_hash)) {
      const msg = `${fileName}: requirements_hash must be a 64-character hexadecimal SHA-256 digest`;
      recordProblem(msg, errors, warnings, isLegacySprint);
    } else {
      const computedHash = computeRequirementsHash(data, projectDir);
      const hashError = computedHash.error || (
        data.requirements_hash.toLowerCase() !== computedHash.hash
          ? 'requirements_hash mismatch; regenerate the requirements review from current inputs'
          : null
      );
      if (hashError) {
        const msg = `${fileName}: ${hashError}`;
        recordProblem(msg, errors, warnings, isLegacySprint);
      }
    }
    for (const validationError of validateRequirementsExpertEvidence(data)) {
      const msg = `${fileName}: ${validationError}`;
      recordProblem(msg, errors, warnings, isLegacySprint);
    }

  }
}

function validateEvidence(phase, projectDir) {
  const evidenceConfig = EVIDENCE_FILES[phase];
  if (!evidenceConfig) {
    return { ok: true, errors: [], warnings: [] };
  }

  const isLegacySprint = readEvidenceSchemaVersion(projectDir) < 2;
  const errors = [];
  const warnings = [];

  const evidenceFilePath = path.join(projectDir, evidenceConfig.path);
  const fileName = path.basename(evidenceConfig.path);

  const loaded = loadEvidence(evidenceFilePath, evidenceConfig.path, errors, warnings, isLegacySprint);
  if (loaded.verdict) return loaded.verdict;
  const data = loaded.data;

  // Check required fields
  for (const field of evidenceConfig.requiredFields) {
    if (!(field in data)) {
      const msg = `${fileName} is missing required field: ${field}`;
      recordProblem(msg, errors, warnings, isLegacySprint);
    }
  }

  // If any required fields missing for new sprint, block early
  if (errors.length > 0) {
    return { ok: false, errors, warnings };
  }

  // Run blocking check
  if (!evidenceConfig.blockingCheck(data)) {
    const msg = `${fileName}: ${evidenceConfig.blockingMessage}`;
    if (recordProblem(msg, errors, warnings, isLegacySprint)) {
      return { ok: true, errors: [], warnings };
    }
    return { ok: false, errors, warnings };
  }

  checkPhaseSpecificEvidence(phase, fileName, data, projectDir, errors, warnings, isLegacySprint);

  if (errors.length > 0) {
    return { ok: false, errors, warnings };
  }

  return { ok: true, errors: [], warnings };
}

/**
 * Append an evidence-skipped audit entry to .xp-gate/audit.jsonl.
 * @param {string} projectDir
 * @param {number} phase
 * @param {string} reason
 */
/**
 * Record that evidence was skipped, and why.
 *
 * This is the audit trail `--skip-evidence` promises: a bypass that leaves no
 * trace is not an audited bypass. A write failure is reported rather than
 * swallowed -- silently losing the record would defeat the point of asking for a
 * reason.
 */
function logEvidenceSkip(projectDir, phase, reason) {
  const auditDir = path.join(projectDir, '.xp-gate');
  const entry = {
    timestamp: new Date().toISOString(),
    event: 'evidence_skipped',
    phase,
    reason,
    commit_hash: getCurrentHeadCommit(projectDir) ?? 'unknown',
  };
  try {
    if (!fs.existsSync(auditDir)) {
      fs.mkdirSync(auditDir, { recursive: true });
    }
    fs.appendFileSync(path.join(auditDir, 'audit.jsonl'), JSON.stringify(entry) + '\n', 'utf8');
  } catch (err) {
    console.warn(`⚠️  Could not record the evidence skip in .xp-gate/audit.jsonl: ${err.message}`);
  }
}

/**
 * Render ASCII dashboard from sprint state.
 * Reuses the formatSprintTable logic from sprint-status.
 * @param {object} state - Sprint state object
 * @returns {string} Rendered dashboard
 */
/**
 * Append the "outputs" block to the dashboard frame.
 *
 * A long value is clipped to the frame's inner width rather than wrapping: the
 * dashboard is scanned as a table, and a wrapped row breaks the columns for every
 * line after it.
 *
 * @param {string[]} lines mutated in place
 * @param {object|undefined} outputs
 */
function appendOutputsSection(lines, outputs) {
  if (!outputs || Object.keys(outputs).length === 0) return;
  // Every row is `|` + FRAME_INNER_WIDTH + `|`. The content width therefore depends
  // on that row's own lead-in, and computing both from `FRAME_INNER_WIDTH` is what
  // keeps the frame square -- the previous version derived the heading from one
  // subtraction and the rows from another, and produced three different widths.
  const contentWidth = (leadIn) => FRAME_INNER_WIDTH - leadIn.length;
  const heading = '  输出物: ';
  lines.push(`|${heading}${' '.repeat(contentWidth(heading))}|`);
  for (const [key, val] of Object.entries(outputs)) {
    const leadIn = '    ';
    const body = `${key}: ${val}`.slice(0, contentWidth(leadIn)).padEnd(contentWidth(leadIn));
    lines.push(`|${leadIn}${body}|`);
  }
  lines.push(`+${'='.repeat(FRAME_INNER_WIDTH)}+`);
}

/**
 * Index phase history by phase number, as strings.
 *
 * The keys are strings because they round-trip through JSON; indexing with a
 * number silently misses.
 *
 * @param {Array|undefined} phaseHistory
 * @returns {Object<string, object>}
 */
function buildHistoryLookup(phaseHistory) {
  const lookup = {};
  if (!Array.isArray(phaseHistory)) return lookup;
  for (const entry of phaseHistory) {
    lookup[String(entry.phase)] = entry;
  }
  return lookup;
}

/**
 * `[███▓░░░] 42%` -- completed, current, and remaining.
 *
 * The current phase gets its own block so "in progress" is visible at a glance;
 * a bar with only completed blocks cannot distinguish phase 3 running from phase
 * 3 not started.
 *
 * @param {Object<string, object>} lookup
 * @param {number} currentPhase
 * @returns {string}
 */
function buildProgressBar(lookup, currentPhase) {
  const completed = Object.values(lookup).filter((h) => h.status === 'completed').length;
  const pct = Math.round((completed / PHASE_COUNT) * 100);
  const inProgress = currentPhase <= PHASE_CLOSE ? 1 : 0;
  const remaining = Math.max(0, PHASE_COUNT - completed - inProgress);
  return `[${'█'.repeat(completed)}${'▓'.repeat(inProgress)}${'░'.repeat(remaining)}] ${pct}%`;
}



/**
 * The dashboard's title block: what this sprint is, and where it stands.
 *
 * Every field is clipped to its column so a long branch name cannot push the
 * closing `|` off the right edge and turn the frame into ragged text.
 *
 * @param {string[]} lines mutated in place
 * @param {{sprintId: string, taskDesc: string, branch: string, overallStatus: string, startedAt: string}} f
 */
function appendFrameHeader(lines, f) {
  // One width helper for every row. Each row hand-computing its own padding is how
  // the frame went ragged: `rule`, `blank` and `field` each subtracted a different
  // constant from FRAME_INNER_WIDTH and disagreed by several columns.
  const row = (content) => `|${content.slice(0, FRAME_INNER_WIDTH).padEnd(FRAME_INNER_WIDTH)}|`;
  const rule = `+${'='.repeat(FRAME_INNER_WIDTH)}+`;

  lines.push(rule);
  // The sprint id is right-aligned in the title row; dropping it made a dashboard
  // of several sprints indistinguishable.
  const title = '  SPRINT PROGRESS';
  lines.push(row(title + f.sprintId.padStart(FRAME_INNER_WIDTH - title.length)));
  lines.push(rule);
  lines.push(row(`  需求: ${f.taskDesc}`));
  lines.push(row(`  分支: ${f.branch}`));
  lines.push(row(`  状态: ${f.overallStatus}   启动: ${f.startedAt}`));
  lines.push(rule);
  lines.push(row(''));
}

function renderDashboard(state) {
  if (!state) return 'No sprint state found';

  const PHASE_NAMES_LOCAL = PHASE_NAMES;

  const branch = state.isolation?.branch || 'unknown';
  const sprintId = state.id || 'unknown';
  const taskDesc = state.task_description || state.issue_title || '-';
  const overallStatus = state.status || 'running';
  const startedAt = state.started_at ? state.started_at.slice(0, TIMESTAMP_MINUTE_LENGTH).replace('T', ' ') : '-';

  const historyLookup = buildHistoryLookup(state.phase_history);

  const currentPhase = state.phase || PHASE_PREP;
  const currentPhaseName = PHASE_NAMES_LOCAL[String(currentPhase)] || `Phase ${currentPhase}`;
  const progressBar = buildProgressBar(historyLookup, currentPhase);

  // Build lines
  const lines = [];
  appendFrameHeader(lines, { sprintId, taskDesc, branch, overallStatus, startedAt });

  for (let i = PHASE_PREP; i <= PHASE_CLOSE; i++) {
    const entry = historyLookup[String(i)];
    const icon = statusIcon(entry?.status || (i < currentPhase ? 'completed' : i === currentPhase ? 'in_progress' : 'pending'));
    const name = (PHASE_NAMES_LOCAL[String(i)] || `Phase ${i}`).padEnd(10);
    const dur = formatDuration(entry?.duration_seconds).padEnd(DURATION_COLUMN_WIDTH);
    lines.push(`|  ${icon} Phase ${i}/6  ${name} ${dur}          |`);
  }

  lines.push('|                                                             |');
  lines.push(`|  ${progressBar.padEnd(FRAME_INNER_WIDTH)}|`);
  lines.push('+============================================================+');
  lines.push(`|  > 当前: Phase ${currentPhase}/${PHASE_CLOSE} ${currentPhaseName}`.padEnd(FRAME_ROW_WIDTH) + '|');
  lines.push(`|    状态: ${(entry_status(currentPhase, historyLookup)).padEnd(FRAME_INNER_WIDTH - 8)}|`);
  lines.push('+============================================================+');

  appendOutputsSection(lines, state.outputs);
  return lines.join('\n');

  function entry_status(phaseNum, lookup) {
    const e = lookup[String(phaseNum)];
    return e?.status || (phaseNum < currentPhase ? 'completed' : phaseNum === currentPhase ? 'in_progress' : 'pending');
  }
}

/**
 * Parse phase-transition arguments.
 *
 * Extracted from `handlePhaseTransition` (CCN 51), whose first 40 lines were
 * argv parsing before any domain logic ran. Returns `{ error }` instead of
 * printing and returning a code, so the caller keeps one exit path.
 *
 * @param {string[]} args
 * @returns {{phase?: number, status?: string, projectDir?: string, renderFlag?: boolean,
 *   outputs?: object, skipEvidence?: boolean, skipEvidenceReason?: string,
 *   forceTransition?: boolean, error?: string}}
 */
function parseTransitionArgs(args) {
  if (args.length < 2) {
    return { error: 'Missing required arguments. Usage: xp-gate phase-transition <phase> <status>' };
  }

  const dirIdx = args.indexOf("--dir");
  const outputsIdx = args.indexOf("--outputs");
  let outputs = {};
  if (outputsIdx >= 0 && args[outputsIdx + 1]) {
    try {
      outputs = JSON.parse(args[outputsIdx + 1]);
    } catch (err) {
      return { error: `Invalid JSON for --outputs: ${err.message}` };
    }
  }

  const skipEvidenceIdx = args.indexOf("--skip-evidence");
  let skipEvidence = false;
  let skipEvidenceReason = "";
  if (skipEvidenceIdx >= 0) {
    skipEvidence = true;
    const nextArg = args[skipEvidenceIdx + 1];
    // The reason is the next arg when it exists and is not another flag.
    if (nextArg && !nextArg.startsWith('--')) skipEvidenceReason = nextArg;
  }

  return {
    phase: parseInt(args[0], 10),
    status: args[1],
    projectDir: dirIdx >= 0 ? args[dirIdx + 1] : process.cwd(),
    renderFlag: args.includes("--render"),
    outputs,
    skipEvidence,
    skipEvidenceReason,
    forceTransition: args.includes("--force"),
  };
}

/**
 * Refuse to complete a phase whose predecessor was not completed or skipped.
 *
 * #519 Layer 0. `completed` on phase n requires phase n-1 to be finished first:
 * #507 proved a missed transition is invisible in the state file (the pointer
 * just looks "not yet advanced"), so out-of-order completion must be refused
 * loudly rather than written silently. `--force` overrides for the rare
 * legitimate case (retroactively recording a skipped phase).
 *
 * @param {object} manager SprintStateManager
 * @param {number} phase
 * @param {string} status
 * @param {boolean} forceTransition
 * @returns {boolean} true when the transition may proceed
 */
function passesSequenceGuard(manager, phase, status, forceTransition) {
  if (status !== 'completed' || phase < PHASE_DESIGN) return true;
  const seqState = manager.read();
  if (!seqState || !Array.isArray(seqState.phase_history)) return true;

  const prevPhase = phase - 1;
  const prevEntry = seqState.phase_history.find((e) => e.phase === prevPhase);
  const prevOk = prevEntry && (prevEntry.status === 'completed' || prevEntry.status === 'skipped');
  if (prevOk) return true;

  if (forceTransition) {
    console.warn(`⚠️  [sprint-audit] Sequence guard overridden (--force): phase ${prevPhase} is not completed/skipped.`);
    return true;
  }

  const summary = seqState.phase_history
    .map((e) => `  ${e.phase}:${e.phase_name || PHASE_NAMES[e.phase] || '?'} = ${e.status}`)
    .join('\n');
  console.error(`❌ [sprint-audit] Cannot complete phase ${phase} (${PHASE_NAMES[phase]}):`);
  console.error(`   phase ${prevPhase} (${PHASE_NAMES[prevPhase]}) is not completed/skipped.`);
  console.error('   Current phase history:');
  console.error(summary || '  (empty)');
  console.error(`   Advance it first: xp-gate phase-transition ${prevPhase} completed`);
  console.error('   Or override explicitly: --force');
  return false;
}

/**
 * Print the phase-transition usage text.
 *
 * Separated so the command body reads as what it does. The text is the contract
 * users copy from, so it lives in one place.
 */
function printTransitionUsage() {
    console.log('Usage: xp-gate phase-transition <phase> <status> [options]');
    console.log('');
    console.log('Arguments:');
    console.log('  phase    Phase number (1-6)');
    console.log('  status   Status: in_progress | completed | skipped | failed | paused');
    console.log('');
    console.log('Options:');
    console.log('  --outputs <json>   JSON object of outputs to record');
    console.log('  --render           Render ASCII dashboard after transition');
    console.log('  --dir <path>       Project directory (default: cwd)');
    console.log('  --skip-evidence <reason>  Skip evidence validation (requires reason)');
    console.log('  --force            Override the phase sequence guard (#519)');
    console.log('');
    console.log('Examples:');
    console.log('  xp-gate phase-transition 1 completed');
    console.log('  xp-gate phase-transition 3 completed --render');
    console.log('  xp-gate phase-transition 2 in_progress --outputs \'{"spec":"path.yaml"}\'');
    console.log('  xp-gate phase-transition 4 completed --skip-evidence "Emergency hotfix"');
    console.log('  xp-gate phase-transition 3 completed --force   # skip-order override');
}

/**
 * Warn when the phase being entered had an unfinished predecessor.
 *
 * Layer 1 of the #519 guard. Unlike layer 0 it does NOT block: entering a phase
 * whose predecessor was never marked complete is a warning, because the state
 * file is a record of what someone reported, not a source of truth about what
 * happened, and blocking on it would strand a sprint whose history was lost.
 *
 * Extracted so `handlePhaseTransition` loses both its deepest nesting and a
 * dozen lines it does not need to read.
 *
 * @param {object} manager SprintStateManager
 * @param {number} phase
 * @param {string} status
 */
function warnOnUnfinishedPredecessor(manager, phase, status) {
  if (status !== 'in_progress' || phase < PHASE_DESIGN) return;

  const preState = manager.read();
  if (!preState || !Array.isArray(preState.phase_history)) return;

  const prevPhase = phase - 1;
  const prevEntry = preState.phase_history.find((e) => e.phase === prevPhase);
  const prevName = PHASE_NAMES[prevPhase] || `Phase ${prevPhase}`;
  // 'completed' and 'skipped' are both valid predecessor statuses.
  if (!prevEntry || (prevEntry.status !== 'completed' && prevEntry.status !== 'skipped')) {
    console.warn(`⚠️  [sprint-audit] Phase ${prevPhase} (${prevName}) not recorded as 'completed'`);
    console.warn(`   Previous phase may have been skipped. Run: xp-gate phase-transition ${prevPhase} completed`);
  }
}

/**
 * Layer 2 of the #519 guard: completing a phase requires its evidence.
 *
 * `--skip-evidence` is an audited bypass, not a silent one: it demands a reason,
 * records the skip, and warns that a third skip in one sprint raises an alert.
 * The command cannot tell whether a skip was justified, so it makes the skip
 * visible to the retro instead.
 *
 * @param {number} phase
 * @param {string} projectDir
 * @param {string} status
 * @param {boolean} skipEvidence
 * @param {string} skipEvidenceReason
 * @returns {boolean} true when the transition may proceed
 */
function checkEvidenceGate(phase, projectDir, status, skipEvidence, skipEvidenceReason) {
  if (status !== 'completed' || !EVIDENCE_FILES[phase]) return true;

  if (skipEvidence) {
    if (!skipEvidenceReason) {
      console.error('Error: --skip-evidence requires --reason "<text>" to be provided');
      return false;
    }
    logEvidenceSkip(projectDir, phase, skipEvidenceReason);
    console.warn('⚠️  Evidence skipped. This will appear in retro reports. Single-sprint limit: >2 skips per sprint will trigger an alert.');
    return true;
  }

  const evidence = validateEvidence(phase, projectDir);
  for (const w of evidence.warnings) {
    console.warn(`⚠️  [sprint-audit] ${w}`);
  }
  if (evidence.ok) return true;

  for (const e of evidence.errors) {
    console.error(`❌ [sprint-audit] ${e}`);
  }
  console.error(`   Phase ${phase} (${PHASE_NAMES[phase]}) cannot transition to 'completed' without valid evidence.`);
  console.error('   Use --skip-evidence "<reason>" to bypass (audited).');
  return false;
}

/** The statuses a phase transition may name. */
const VALID_TRANSITION_STATUSES = ['in_progress', 'completed', 'skipped', 'failed', 'paused'];

/**
 * Reject a phase number or status that cannot apply, naming what IS valid.
 *
 * Pure check-and-report. `parseInt('abc')` is NaN, and NaN fails every comparison
 * silently, so the guard is what keeps a typo from reaching the state file.
 *
 * @param {number} phase
 * @param {string} status
 * @returns {boolean}
 */
function validateTransitionInput(phase, status) {
  if (!Number.isInteger(phase) || phase < PHASE_PREP || phase > PHASE_CLOSE) {
    console.error(`Error: Phase must be 1-6, got ${phase}`);
    return false;
  }
  if (!VALID_TRANSITION_STATUSES.includes(status)) {
    console.error(`Error: Status must be one of: ${VALID_TRANSITION_STATUSES.join(', ')}`);
    return false;
  }
  return true;
}

/**
 * Apply the transition and echo what changed.
 *
 * The #507 failure mode was "the command either never ran or ran without effect"
 * -- both look identical in a terminal that only prints a success line. Printing
 * the observed state on both sides is what makes the two distinguishable in the
 * output itself, without needing to open the state file.
 *
 * @param {object} manager SprintStateManager
 * @param {number} phase
 * @param {string} status
 * @param {object} outputs
 * @returns {object} the new state
 */
function applyTransition(manager, phase, status, outputs) {
    // Capture the before-image for the echo below (#519). Read once here so a
    // concurrent writer cannot make before/after disagree about their baseline.
    const beforeSnapshot = (() => {
      try {
        const s = manager.read();
        if (!s) return { phase: undefined, status: undefined, entryStatus: undefined };
        const e = Array.isArray(s.phase_history) ? s.phase_history.find(x => x.phase === phase) : undefined;
        return { phase: s.phase, status: s.status, entryStatus: e ? e.status : undefined };
      } catch {
        return { phase: undefined, status: undefined, entryStatus: undefined };
      }
    })();

    const newState = manager.transitionPhase(phase, status, { outputs });

    // #519: before/after echo. The #507 failure mode was "the command either
    // never ran or ran without effect" — both look identical in a terminal that
    // prints only a success line. Printing the observed state on both sides
    // makes those two cases distinguishable in the output itself.
    const afterEntry = Array.isArray(newState.phase_history)
      ? newState.phase_history.find(e => e.phase === phase)
      : undefined;
    const oldTop = `${beforeSnapshot.phase ?? '-'}/${beforeSnapshot.status ?? '-'}`;
    const newTop = `${newState.phase ?? '-'}/${newState.status ?? '-'}`;
    const oldEntry = beforeSnapshot.entryStatus ?? '(none)';
    const newEntryStatus = afterEntry ? afterEntry.status : '(none)';
    console.log(`✅ Phase ${phase} transitioned to '${status}'`);
    console.log(`   before→after  phase/status: ${oldTop} → ${newTop}  |  phase ${phase} entry: ${oldEntry} → ${newEntryStatus}`);
}

/**
 * What to print after a successful transition: the closing reminder and the
 * optional dashboard.
 *
 * Layer 1.5 of the #519 guard: completing CLOSE means the sprint is over, and
 * that is the moment a final audit is worth running -- so the reminder fires
 * there rather than needing to be remembered.
 *
 * @param {number} phase
 * @param {string} status
 * @param {boolean} renderFlag
 * @param {object} newState
 */
function printTransitionFollowUps(phase, status, renderFlag, newState) {
  if (phase === PHASE_CLOSE && status === 'completed') {
    console.log('');
    console.log('📋 [sprint-audit] Sprint complete — run final coverage audit:');
    console.log('   npx xp-gate sprint-audit');
  }
  if (renderFlag) {
    console.log('');
    console.log(renderDashboard(newState));
  }
}

async function handlePhaseTransition(args = []) {
  if (args.includes('--help')) {
    printTransitionUsage();
    return 0;
  }

  const parsed = parseTransitionArgs(args);
  if (parsed.error) {
    console.error(`Error: ${parsed.error}`);
    return 1;
  }
  const { phase, status, projectDir, renderFlag, outputs,
    skipEvidence, skipEvidenceReason, forceTransition } = parsed;

  if (!validateTransitionInput(phase, status)) return 1;

  // Execute transition
  try {
    const manager = new SprintStateManager(projectDir);

    // ── #519 Layer 0: Sequence guard ──
    if (!passesSequenceGuard(manager, phase, status, forceTransition)) return 1;

    // ── Layer 1: Pre-transition gate check ──
    warnOnUnfinishedPredecessor(manager, phase, status);

    // ── Layer 2: Evidence validation ──
    if (!checkEvidenceGate(phase, projectDir, status, skipEvidence, skipEvidenceReason)) return 1;

    const newState = applyTransition(manager, phase, status, outputs);

    printTransitionFollowUps(phase, status, renderFlag, newState);

    return 0;
  } catch (err) {
    console.error(`Error: Phase transition failed: ${err.message}`);
    return 1;
  }
}

/**
 * Read-only evidence check for a given phase. Validates evidence without modifying sprint state.
 * D3 (Unify Evidence Validation): replaces sprint-gate.sh inline JSON parsing.
 *
 * @param {number} phase - Phase number (1-6)
 * @param {string} projectDir - Project root directory
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */

const {
  checkEvidence, checkWalkthrough, checkBypassAudit, validateWalkthroughVerdict,
  loadWalkthroughFile, createRepositoryGitEnv, GIT_REPOSITORY_ENV_VARS,
} = require('./prepush-evidence.js');

module.exports = { buildHistoryLookup, buildProgressBar, statusIcon, formatDuration, appendOutputsSection, appendFrameHeader,
  handlePhaseTransition, renderDashboard, PHASE_NAMES, validateEvidence, checkEvidence, checkWalkthrough, checkBypassAudit };
