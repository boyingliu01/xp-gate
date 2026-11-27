'use strict';
/**
 * Read-only repository access for the Delphi reviewers.
 *
 * The review sends a SLICE of the repository, and a slice cannot answer the question the
 * Feasibility seat kept asking: "where did the deleted function go?". Measured over 29
 * batches of a 246-file refactor, that seat approved 0; nearly every rejection was a claim
 * that code had DISAPPEARED, when it had merely moved to a file the batch did not include.
 *
 * Moved out of `delphi-external-review.cjs` both for the 1050-line ceiling and because it
 * is a separate concern: what the model may LOOK AT, as opposed to how a review is framed.
 * Every path is resolved inside the repository root and refused otherwise -- the model's
 * arguments are not trusted input.
 */
const fs = require('node:fs');
const path = require('node:path');

// ── Repo access tools ─────────────────────────────────────────────────
//
// The review sends a SLICE of the repository, and a slice cannot answer the question the
// Feasibility seat kept asking: "where did the deleted function go?". Measured over 29
// batches, that seat approved 0 of them, and nearly every rejection was a claim that code
// had DISAPPEARED -- the code was there, in a file the batch did not include.
//
// These tools let the expert look instead of assuming. Every call is confined to the
// repository root and refuses paths outside it, because the model's arguments are not
// trusted input.
const REPO_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a file from the repository, optionally a line range. Use this when the diff references code you cannot see.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Repository-relative path' },
          start_line: { type: 'integer', description: 'First line (1-based). Omit for the whole file.' },
          end_line: { type: 'integer', description: 'Last line, inclusive.' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'grep',
      description: 'Search the repository for a regular expression, returning matching lines with file and line number.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regular expression to search for' },
          glob: { type: 'string', description: 'Optional file glob, e.g. "*.cjs"' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List repository files under a directory, or matching a glob.',
      parameters: {
        type: 'object',
        properties: {
          dir: { type: 'string', description: 'Repository-relative directory' },
          glob: { type: 'string', description: 'Optional glob filter, e.g. "delphi-*.cjs"' },
        },
        required: ['dir'],
      },
    },
  },
];

/** Resolve a model-supplied path inside `root`, or null when it escapes. */
function resolveInRepo(root, relPath) {
  if (typeof relPath !== 'string' || relPath === '') return null;
  const abs = path.resolve(root, relPath);
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return abs;
}

/** One tool call's result, always a string (the API requires text). */
function runRepoTool(call, root) {
  let args = {};
  try {
    args = JSON.parse(call.function?.arguments || '{}');
  } catch {
    return `error: could not parse the arguments as JSON: ${call.function?.arguments ?? '(none)'}`;
  }
  switch (call.function?.name) {
    case 'read_file': return toolReadFile(args, root);
    case 'grep': return toolGrep(args, root);
    case 'list_files': return toolListFiles(args, root);
    default: return `error: unknown tool ${call.function?.name}`;
  }
}

function toolReadFile(args, root) {
  const abs = resolveInRepo(root, args.path);
  if (!abs) return `error: ${args.path} is outside the repository`;
  let text;
  try {
    text = fs.readFileSync(abs, 'utf8');
  } catch (err) {
    return `error: cannot read ${args.path}: ${err.message}`;
  }
  const lines = text.split('\n');
  const start = Number.isInteger(args.start_line) ? Math.max(1, args.start_line) : 1;
  const end = Number.isInteger(args.end_line) ? Math.min(lines.length, args.end_line) : lines.length;
  if (end < start) return `error: end_line ${end} is before start_line ${start}`;
  return lines.slice(start - 1, end).join('\n');
}

function toolGrep(args, root) {
  if (typeof args.pattern !== 'string' || args.pattern === '') return 'error: pattern is required';
  let re;
  try {
    re = new RegExp(args.pattern);
  } catch (err) {
    return `error: invalid regular expression: ${err.message}`;
  }
  const out = [];
  for (const rel of walkRepoFiles(root)) {
    if (args.glob && !minimatchLike(rel, args.glob)) continue;
    if (out.length >= GREP_MAX_HITS) break;
    grepOneFile(root, rel, re, out);
  }
  return out.length > 0 ? out.join('\n') : 'no matches';
}

/** Append this file's matches to `out`, up to the global cap. */
function grepOneFile(root, rel, re, out) {
  let text;
  try { text = fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return; }
  const lines = text.split('\n');
  for (let i = 0; i < lines.length && out.length < GREP_MAX_HITS; i += 1) {
    if (re.test(lines[i])) out.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
  }
}

function toolListFiles(args, root) {
  const abs = resolveInRepo(root, args.dir ?? '.');
  if (!abs) return `error: ${args.dir} is outside the repository`;
  const out = [];
  for (const rel of walkRepoFiles(root)) {
    const relToDir = path.relative(root, path.join(root, rel));
    if (!relToDir.startsWith(path.relative(root, abs))) continue;
    if (args.glob && !minimatchLike(path.basename(rel), args.glob)) continue;
    out.push(rel);
    if (out.length >= 500) break;
  }
  return out.length > 0 ? out.join('\n') : 'no files';
}

/** Repo files the tools may touch, skipping vendored and generated trees. */
function walkRepoFiles(root, dir = root, acc = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkRepoFiles(root, full, acc);
    else if (e.isFile()) acc.push(path.relative(root, full).split(path.sep).join('/'));
  }
  return acc;
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'coverage', 'dist', '.stryker-tmp', '.xp-gate', '.worktrees']);

/** `*.cjs` / `delphi-*` style matching, without pulling in a glob dependency. */
function minimatchLike(name, glob) {
  const re = new RegExp('^' + glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
  return re.test(name);
}

/**
 * Run the conversation, executing tool calls until the model answers.
 *
 * Bounded on purpose: a model that keeps reading files must not stall the review. Each
 * round's assistant/tool messages are appended so the model keeps its own context.
 */
async function converseWithTools(providerConfig, model, systemPrompt, userPrompt, opts) {
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
  let last = null;
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
    const lastRound = round === MAX_TOOL_ROUNDS;
    if (lastRound) {
      // Tools are withdrawn AND the requirement is restated in the user turn. Without the
      // restatement the model answered in prose after its reading, which the verdict parser
      // rejects -- a tool-using review that cannot produce a verdict is worse than none.
      messages.push({
        role: 'user',
        content: 'No further tool calls are available. Answer NOW with ONLY the JSON verdict object, '
          + 'using exactly the schema from the system prompt. No prose, no code fences.',
      });
    }
    const body = {
      model,
      messages,
      temperature: 0.3,
      ...(lastRound ? {} : { tools: REPO_TOOLS, tool_choice: 'auto' }),
    };
    // eslint-disable-next-line no-await-in-loop
    last = await postChat(providerConfig, body, opts);
    if (!last.ok) return last;
    const message = last.message;
    const calls = message.tool_calls ?? [];
    if (calls.length === 0) return last;
    messages.push(message);
    for (const call of calls) {
      messages.push({ role: 'tool', tool_call_id: call.id, content: runRepoTool(call, opts.repoRoot) });
    }
  }
  return last;
}

const MAX_TOOL_ROUNDS = 8;
const GREP_MAX_HITS = 200;

/**
 * One chat completion round, for the tool conversation.
 *
 * Returns `{ ok: true, message }` with the assistant message, or the error shape
 * `callModelAPI` already produces, so the caller's retry and classification keep working.
 */
async function postChat(providerConfig, body, opts) {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(opts.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${providerConfig.api_key}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    // The status ladder is reused; the BODY is read here, because a tool-calling reply has
    // an EMPTY content and `readSuccessfulResponse` treats that as "no message" -- it was
    // written for single-shot completions, where empty content really is a failure.
    if (!response.ok) return await classifyHttpResponse(response);
    const data = await response.json();
    const message = data?.choices?.[0]?.message;
    if (!message) return { error: true, message: 'No assistant message in the response.' };
    const resolved = typeof data.model === 'string' ? data.model.trim() : '';
    // `content` alongside `message`: the retry path and the verdict parser were written for
    // the single-shot shape and read `.content`, so a tool round that returned only
    // `message` surfaced as "could not be parsed" even when the JSON was right there.
    return { ok: true, message, content: message.content ?? '', resolved_model: resolved };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return {
        error: true,
        retryable: true,
        message: `Request timed out (${timeoutMs}ms). Raise --timeout-ms or the provider's timeout_ms.`,
      };
    }
    return { ok: false, error: true, message: `Tool round failed: ${String(err)}` };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { REPO_TOOLS, converseWithTools, postChat, resolveInRepo, runRepoTool, MAX_TOOL_ROUNDS };
