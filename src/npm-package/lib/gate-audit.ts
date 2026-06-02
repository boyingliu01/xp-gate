/**
 * Gate Audit Logger — structured JSONL audit for quality gate executions.
 *
 * Log file: .xp-gate/audit.jsonl
 * Rotation: max 10 MB, rename to .1, keep up to 3 archives.
 * Fail-safe: write errors never block the caller.
 */
import {
  existsSync,
  mkdirSync,
  appendFileSync,
  writeFileSync,
  readFileSync,
  renameSync,
  statSync,
  chmodSync,
} from 'fs';
import { join } from 'path';

// ── Constants ────────────────────────────────────────────────────────────────

const AUDIT_DIR = '.xp-gate';
const AUDIT_FILE = 'audit.jsonl';
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_ARCHIVES = 3;

// ── Types ────────────────────────────────────────────────────────────────────

export interface GateAuditEntry {
  timestamp: string;
  gate_id: string;
  gate_name: string;
  passed: boolean;
  issues_found: number;
  duration_ms: number;
  trigger: 'commit' | 'push' | 'manual';
  repo_path: string;
  commit_hash: string;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Append one audit entry to .xp-gate/audit.jsonl.
 * Creates the directory lazily on first write.
 * NEVER throws — errors are logged to stderr only.
 */
export function appendAuditEntry(
  entry: GateAuditEntry,
  repoRoot: string = process.cwd(),
): void {
  try {
    const logPath = join(repoRoot, AUDIT_DIR, AUDIT_FILE);

    // Lazy-create directory
    const dirPath = join(repoRoot, AUDIT_DIR);
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true });
    }

    // Rotate before write if file is too large
    rotateIfNeeded(logPath);

    const line = JSON.stringify(entry) + '\n';

    // POSIX append with atomic semantics
    try {
      appendFileSync(logPath, line, 'utf8');
      // Set restrictive permissions on first write (idempotent)
      try {
        chmodSync(logPath, 0o600);
      } catch {
        // chmod may fail on some filesystems — non-fatal
      }
    } catch {
      // Windows fallback: open with 'a' flag
      writeFileSync(logPath, line, { flag: 'a', encoding: 'utf8' });
    }
  } catch (err) {
    // Fail-safe: never propagate errors to caller
    console.error('[xp-gate audit] Failed to append entry:', (err as Error).message);
  }
}

/**
 * Read the last N entries from the audit log.
 */
export function readTailEntries(
  count: number = 20,
  repoRoot: string = process.cwd(),
): GateAuditEntry[] {
  const logPath = join(repoRoot, AUDIT_DIR, AUDIT_FILE);
  if (!existsSync(logPath)) {
    return [];
  }

  const content = readFileSync(logPath, 'utf8').trim();
  if (!content) {
    return [];
  }

  const allLines = content.split('\n');
  const tailLines = allLines.slice(-count);
  const entries: GateAuditEntry[] = [];

  for (const line of tailLines) {
    if (line.trim()) {
      try {
        entries.push(JSON.parse(line) as GateAuditEntry);
      } catch {
        // Skip malformed lines
      }
    }
  }

  return entries;
}

/**
 * Compute per-gate aggregate statistics.
 */
export function computeStats(
  repoRoot: string = process.cwd(),
): { gate_id: string; pass_pct: string; avg_ms: number; avg_issues: number }[] {
  const logPath = join(repoRoot, AUDIT_DIR, AUDIT_FILE);
  if (!existsSync(logPath)) {
    return [];
  }

  const content = readFileSync(logPath, 'utf8').trim();
  if (!content) {
    return [];
  }

  // Parse all valid entries
  const entries: GateAuditEntry[] = [];
  for (const line of content.split('\n')) {
    if (line.trim()) {
      try {
        entries.push(JSON.parse(line) as GateAuditEntry);
      } catch {
        // Skip malformed
      }
    }
  }

  // Aggregate by gate_id
  const buckets = new Map<string, { total: number; passed: number; ms: number; issues: number }>();

  for (const e of entries) {
    const b = buckets.get(e.gate_id) ?? { total: 0, passed: 0, ms: 0, issues: 0 };
    b.total += 1;
    if (e.passed) b.passed += 1;
    b.ms += e.duration_ms;
    b.issues += e.issues_found;
    buckets.set(e.gate_id, b);
  }

  const results: { gate_id: string; pass_pct: string; avg_ms: number; avg_issues: number }[] = [];

  for (const [gate_id, b] of Array.from(buckets.entries())) {
    results.push({
      gate_id,
      pass_pct: (b.total > 0 ? ((b.passed / b.total) * 100).toFixed(1) + '%' : 'N/A'),
      avg_ms: b.total > 0 ? Math.round(b.ms / b.total) : 0,
      avg_issues: b.total > 0 ? parseFloat((b.issues / b.total).toFixed(2)) : 0,
    });
  }

  // Sort by gate_id for stable output
  results.sort((a, b) => a.gate_id.localeCompare(b.gate_id));
  return results;
}

/**
 * Rotate the audit log if it exceeds MAX_FILE_BYTES.
 * Renames current file to .1, shifts existing archives.
 * Keeps at most MAX_ARCHIVES archived files.
 */
export function rotateIfNeeded(logPath: string): void {
  if (!existsSync(logPath)) {
    return;
  }

  let stats;
  try {
    stats = statSync(logPath);
  } catch {
    return;
  }

  if (stats.size < MAX_FILE_BYTES) {
    return;
  }

  // Shift archives: .2 -> .3, .1 -> .2
  for (let i = MAX_ARCHIVES; i >= 2; i--) {
    const from = `${logPath}.${i - 1}`;
    const to = `${logPath}.${i}`;
    if (existsSync(from)) {
      try {
        renameSync(from, to);
      } catch {
        // Race condition or permission issue — skip
      }
    }
  }

  // Current -> .1
  const firstArchive = `${logPath}.1`;
  if (existsSync(firstArchive)) {
    try {
      renameSync(firstArchive, `${logPath}.2`);
    } catch {
      // Skip on error
    }
  }

  try {
    renameSync(logPath, firstArchive);
  } catch {
    // If rename fails, truncate the current file instead
    try {
      writeFileSync(logPath, '', 'utf8');
    } catch {
      console.error('[xp-gate audit] Failed to rotate or truncate log:', logPath);
    }
  }
}

// ── CLI entry point (direct invocation from hooks) ───────────────────────────

/**
 * When called directly via `npx tsx gate-audit.ts record --gate-id ...`,
 * this block handles CLI argument parsing and appends the entry.
 */
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === 'record') {
    const opts = parseCliOptions(args.slice(1));
    const entry: GateAuditEntry = {
      timestamp: new Date().toISOString(),
      gate_id: opts['gate-id'] || 'unknown',
      gate_name: opts['gate-name'] || 'unknown',
      passed: opts['passed'] === 'true',
      issues_found: parseInt(opts['issues-found'] || '0', 10),
      duration_ms: parseInt(opts['duration-ms'] || '0', 10),
      trigger: (opts['trigger'] as 'commit' | 'push' | 'manual') || 'manual',
      repo_path: process.cwd(),
      commit_hash: getCommitHash(),
    };
    appendAuditEntry(entry);
  } else {
    console.error(`Unknown audit command: ${command}`);
    process.exit(1);
  }
}

function parseCliOptions(args: string[]): Record<string, string> {
  const opts: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--') && i + 1 < args.length) {
      opts[args[i].slice(2)] = args[i + 1];
      i++;
    }
  }
  return opts;
}

function getCommitHash(): string {
  try {
    const { execSync } = require('child_process');
    return execSync('git rev-parse HEAD', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return 'unknown';
  }
}
