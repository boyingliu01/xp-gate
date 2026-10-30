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
  rmSync,
} from 'fs';
import { join } from 'path';

// ── Constants ────────────────────────────────────────────────────────────────

const AUDIT_DIR = '.xp-gate';
const AUDIT_FILE = 'audit.jsonl';
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_ARCHIVES = 3;
const MAX_PLAUSIBLE_DURATION_MS = 6 * 60 * 60 * 1000; // 6h — no single gate runs longer

// ── Types ────────────────────────────────────────────────────────────────────

export interface GateAuditEntry {
  timestamp: string;
  gate_id: string;
  gate_name: string;
  passed: boolean;
  issues_found: number;
  duration_ms: number | null; // REQ-B: null = deliberately unmeasurable (see duration_reason)
  trigger: 'commit' | 'push' | 'manual';
  repo_path: string;
  commit_hash: string;
  duration_anomaly?: boolean; // Issue #370: set when duration_ms > max_duration_ms
  duration_reason?: 'poisoned_start_ms' | 'clock_skew'; // REQ-B: why duration_ms is null
  detail?: string; // #507: optional gate-specific payload (e.g. effective CCN threshold)
  /**
   * #651: WHY the gate blocked. Without this the journal can only answer "how
   * many failed", never "which rule fails most" — and the second question is the
   * one that drives fixes. Only meaningful when passed=false.
   */
  failure_reason?: string;
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

// ── Pre-commit staging ───────────────────────────────────────────────────────
// Pre-commit cannot know the commit it is about to create (HEAD is still the
// parent there), so per-gate entries are staged to a sidecar and stamped with
// the real commit by post-commit. Fallback safety: `flushPendingAudit` also
// runs at the START of the next pre-commit, so if post-commit never fired
// (hooks skipped, exception) the entries still land, attributed by `git log -1`
// at that later point — slightly late but never lost, never misattributed to
// the wrong commit when post-commit does run.

const PENDING_SUFFIX = 'audit.pending.jsonl';

function pendingPath(repoRoot: string): string {
  return join(repoRoot, AUDIT_DIR, PENDING_SUFFIX);
}

/** Stage one entry for the not-yet-created commit. Never throws. */
export function stageAuditEntry(entry: GateAuditEntry, repoRoot: string = process.cwd()): void {
  try {
    const dir = join(repoRoot, AUDIT_DIR);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(pendingPath(repoRoot), JSON.stringify(entry) + '\n', 'utf8');
  } catch (err) {
    console.error('[xp-gate audit] Failed to stage entry:', (err as Error).message);
  }
}

/**
 * Move staged entries into audit.jsonl, stamped with the real commit hash.
 * Idempotent and safe to call when nothing is staged. A blank/absent hash
 * leaves `commit_hash` exactly as staged so a wrong commit is never invented.
 */
export function flushPendingAudit(
  repoRoot: string = process.cwd(),
  commitHash: string = '',
): number {
  const p = pendingPath(repoRoot);
  if (!existsSync(p)) return 0;
  let flushed = 0;
  try {
    const raw = readFileSync(p, 'utf8');
    const lines = raw.split('\n').filter((l) => l.trim());
    for (const line of lines) {
      let entry: GateAuditEntry;
      try {
        entry = JSON.parse(line) as GateAuditEntry;
      } catch {
        // A torn line (interrupted mid-write) is dropped rather than crashing
        // the hook that is trying to flush a previous run's leftovers.
        continue;
      }
      if (commitHash) entry.commit_hash = commitHash;
      appendAuditEntry(entry, repoRoot);
      flushed++;
    }
    rmSyncSafe(p);
  } catch (err) {
    console.error('[xp-gate audit] Failed to flush pending entries:', (err as Error).message);
  }
  return flushed;
}

function rmSyncSafe(p: string): void {
  try {
    rmSync(p, { force: true });
  } catch {
    /* best effort */
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
 * Read and parse all valid audit entries from the log file.
 */
function parseAuditEntries(logPath: string): GateAuditEntry[] {
  if (!existsSync(logPath)) {
    return [];
  }

  const content = readFileSync(logPath, 'utf8').trim();
  if (!content) {
    return [];
  }

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
  return entries;
}

/**
 * Aggregate audit entries by gate_id, computing sums for passed/ms/issues.
 */
function aggregateByGate(entries: GateAuditEntry[]): Map<string, { total: number; passed: number; ms: number; issues: number; anomaly_count: number }> {
  const buckets = new Map<string, { total: number; passed: number; ms: number; issues: number; anomaly_count: number }>();

  for (const e of entries) {
    // Tolerate malformed/legacy rows: a missing gate_id would otherwise create
    // an `undefined` bucket key (and crash the sort comparing it to a string).
    const gateId = typeof e.gate_id === 'string' && e.gate_id ? e.gate_id : 'unknown';
    const b = buckets.get(gateId) ?? { total: 0, passed: 0, ms: 0, issues: 0, anomaly_count: 0 };
    b.total += 1;
    if (e.passed) b.passed += 1;
    // Issue #370: exclude anomalous durations from ms aggregation. REQ-B: a
    // null duration is the honest sibling of that flag — deliberately not
    // measurable, so it stays out of the sums (and out of the denominator).
    if (e.duration_anomaly === true) {
      b.anomaly_count += 1;
    } else if (typeof e.duration_ms === 'number') {
      b.ms += e.duration_ms;
    }
    // A malformed/legacy row with a non-numeric issues_found must not turn
    // the whole gate's average into NaN.
    b.issues += Number.isFinite(e.issues_found) ? e.issues_found : 0;
    buckets.set(gateId, b);
  }

  return buckets;
}

/**
 * Compute per-gate aggregate statistics.
 */
export function computeStats(
  repoRoot: string = process.cwd(),
): { gate_id: string; pass_pct: string; avg_ms: number; avg_issues: number; anomaly_count: number }[] {
  const logPath = join(repoRoot, AUDIT_DIR, AUDIT_FILE);
  const entries = parseAuditEntries(logPath);
  if (entries.length === 0) {
    return [];
  }

  const buckets = aggregateByGate(entries);

  const results: { gate_id: string; pass_pct: string; avg_ms: number; avg_issues: number; anomaly_count: number }[] = [];

  for (const [gate_id, b] of Array.from(buckets.entries())) {
    // Issue #370: avg_ms computed only over non-anomalous entries
    const normalCount = b.total - b.anomaly_count;
    results.push({
      gate_id,
      pass_pct: (b.total > 0 ? ((b.passed / b.total) * 100).toFixed(1) + '%' : 'N/A'),
      avg_ms: normalCount > 0 ? Math.round(b.ms / normalCount) : 0,
      avg_issues: b.total > 0 ? parseFloat((b.issues / b.total).toFixed(2)) : 0,
      anomaly_count: b.anomaly_count,
    });
  }

  results.sort((a, b) => a.gate_id.localeCompare(b.gate_id));
  return results;
}

export interface AuditAnomalies {
  /** Entries with an explicit duration_anomaly flag (Issue #370). */
  flagged: number;
  /** Entries with a null duration + reason (REQ-B unmeasurable). */
  null_with_reason: number;
  /** Entries persisting a provably-impossible duration (>6h / negative). */
  implausible_duration: number;
  /** Entries with no commit attribution (the off-by-one bug's fingerprints). */
  missing_commit: number;
  /** Sum of the above — the number CI should treat as "must be 0". */
  total: number;
  /** Running counter of entries scanned. */
  scanned: number;
}

/**
 * Count audit-health problems so CI can fail when the ledger is untrustworthy.
 *
 * These are exactly the artefacts of the two telemetry bugs we fixed: epoch
 * durations (implausible_duration) and misattributed/blank commits
 * (missing_commit). A clean ledger returns total=0.
 *
 * `since` (ISO-8601) scopes the check to entries at/after that instant. Both
 * bugs predate the fix and left ~900 historical rows in the ledger; a CI gate
 * that counted them would be permanently red. Scoping by the fix date turns
 * the gate into "no NEW anomalies", which is exactly what we can enforce.
 */
export function computeAnomalies(repoRoot: string = process.cwd(), since?: string): AuditAnomalies {
  const logPath = join(repoRoot, AUDIT_DIR, AUDIT_FILE);
  const entries = parseAuditEntries(logPath);
  let flagged = 0;
  let null_with_reason = 0;
  let implausible = 0;
  let missingCommit = 0;
  let considered = 0;
  for (const e of entries) {
    if (since && typeof e.timestamp === 'string' && e.timestamp < since) continue;
    considered += 1;
    if (e.duration_anomaly === true) flagged += 1;
    if (e.duration_ms === null && e.duration_reason) null_with_reason += 1;
    if (typeof e.duration_ms === 'number'
      && (!Number.isFinite(e.duration_ms) || e.duration_ms < 0 || e.duration_ms > MAX_PLAUSIBLE_DURATION_MS)) {
      implausible += 1;
    }
    if (!e.commit_hash || e.commit_hash === 'unknown') missingCommit += 1;
  }
  return {
    flagged,
    null_with_reason,
    implausible_duration: implausible,
    missing_commit: missingCommit,
    total: implausible + missingCommit,
    scanned: considered,
  };
}

/**
 * Entries at/after this instant are expected to be clean. It is the date the
 * two telemetry bugs were fixed; anything older is grandfathered because it
 * cannot be re-measured. Keep in sync with the fix commit if you regenerate.
 */
export const AUDIT_ANOMALY_SINCE = '2026-10-30T00:00:00.000Z';


/**
 * Rotate the audit log if it exceeds MAX_FILE_BYTES.
 * Renames current file to .1, shifts existing archives.
 * Keeps at most MAX_ARCHIVES archived files.
 */
function shouldRotate(logPath: string): boolean {
  if (!existsSync(logPath)) return false;
  try {
    return statSync(logPath).size >= MAX_FILE_BYTES;
  } catch {
    return false;
  }
}

function shiftOldArchives(logPath: string): void {
  for (let i = MAX_ARCHIVES; i >= 2; i--) {
    const from = `${logPath}.${i - 1}`;
    const to = `${logPath}.${i}`;
    if (existsSync(from)) {
      try { renameSync(from, to); } catch { /* skip */ }
    }
  }
}

function archiveCurrent(logPath: string): void {
  const first = `${logPath}.1`;
  if (existsSync(first)) {
    try { renameSync(first, `${logPath}.2`); } catch { /* skip */ }
  }
  try {
    renameSync(logPath, first);
  } catch {
    try { writeFileSync(logPath, '', 'utf8'); } catch { /* skip */ }
  }
}

export function rotateIfNeeded(logPath: string): void {
  if (!shouldRotate(logPath)) return;
  shiftOldArchives(logPath);
  archiveCurrent(logPath);
}

function runCli(): void {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === 'record') {
    const opts = parseCliOptions(args.slice(1));
    // Writer-side backstop: never persist an implausible duration (epoch-sized
    // `end - 0`, unit error). Any caller-supplied reason wins; otherwise a
    // rejected number is recorded as null + poisoned_start_ms.
    const rawDuration = opts['duration-ms'] === 'null' ? null : parseInt(opts['duration-ms'] || '0', 10);
    const durationCheck = sanitizeDurationMs(rawDuration);
    const durationReason = opts['duration-reason'] || durationCheck.duration_reason;
    const entry: GateAuditEntry = {
      timestamp: new Date().toISOString(),
      gate_id: opts['gate-id'] || 'unknown',
      gate_name: opts['gate-name'] || 'unknown',
      passed: opts['passed'] === 'true',
      issues_found: parseInt(opts['issues-found'] || '0', 10),
      duration_ms: durationCheck.duration_ms,
      trigger: (opts['trigger'] as 'commit' | 'push' | 'manual') || 'manual',
      repo_path: process.cwd(),
      // Pre-commit runs BEFORE the commit object exists, so `git rev-parse HEAD`
      // here resolves the PARENT. resolveCommitHash lets an explicit
      // --commit-hash win and falls back to HEAD otherwise.
      commit_hash: resolveCommitHash(opts),
      // Issue #370: only set when explicitly flagged (omit field otherwise)
      ...(opts['duration-anomaly'] === 'true' ? { duration_anomaly: true } : {}),
      // REQ-B: why the duration is null — never guess a number for it.
      ...(durationReason ? { duration_reason: durationReason as 'poisoned_start_ms' | 'clock_skew' } : {}),
      // #507: only set when provided (omit field otherwise)
      ...(opts['detail'] ? { detail: opts['detail'] } : {}),
      // #651: only set when provided, so successful records stay byte-identical.
      ...(opts['failure-reason'] ? { failure_reason: String(opts['failure-reason']).slice(0, 300) } : {}),
    };
    // Pre-commit (trigger=commit) is staging for a commit that does not exist
    // yet: park it in the pending sidecar so post-commit can stamp the real
    // hash. Its commit_hash is deliberately blank until then — stamping the
    // parent here is exactly the off-by-one we are removing.
    if (entry.trigger === 'commit' && !opts['commit-hash']) {
      entry.commit_hash = '';
      stageAuditEntry(entry);
    } else {
      appendAuditEntry(entry);
    }
  } else if (command === 'flush-pending') {
    // Called by post-commit with the now-real HEAD.
    const opts = parseCliOptions(args.slice(1));
    const n = flushPendingAudit(process.cwd(), opts['commit-hash'] || '');
    // Quiet by default (hooks are noisy enough); --report prints the count.
    if (opts['report'] === 'true') console.log(`flushed ${n}`);
  } else {
    console.error(`Unknown audit command: ${command}`);
    process.exit(1);
  }
}

if (require.main === module) {
  runCli();
}

export function parseCliOptions(args: string[]): Record<string, string> {
  const opts: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--') && i + 1 < args.length) {
      opts[args[i].slice(2)] = args[i + 1];
      i++;
    }
  }
  return opts;
}

export function getCommitHash(): string {
  try {
    const { execSync } = require('child_process');
    return execSync('git rev-parse HEAD', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Which commit a gate entry belongs to.
 *
 * Pre-commit fires BEFORE the commit object exists, so `git rev-parse HEAD`
 * there returns the PARENT. If the hook let that stand, every gate entry would
 * be filed under the previous commit — the newest commit would look like it
 * "ran no gates", and any per-commit battery analysis silently mixes one
 * commit's timings into another's. An explicit `--commit-hash` (from a caller
 * that knows the subject, e.g. post-commit) always wins; otherwise HEAD is the
 * subject (push/manual) and the resolver is used.
 *
 * `headResolver` is injectable so the precedence can be tested without a repo.
 */
export function resolveCommitHash(
  opts: Record<string, string>,
  headResolver: () => string = getCommitHash,
): string {
  const explicit = (opts['commit-hash'] || '').trim();
  if (explicit) return explicit;
  return headResolver();
}

// ── Duration sanity (last line of defence) ───────────────────────────────────
// The shell side sanitizes start_ms before computing the delta
// (githooks/lib/audit-sanitize.sh, REQ-B). This is the writer-side backstop:
// if any caller path ever hands us a duration that is provably not a real
// gate runtime, refuse to persist it as a number. An epoch-sized value (the
// old bug produced `end - 0 = now`, ~1.7e12) or anything absurdly large would
// otherwise poison every average and p90 downstream and looks exactly like a
// "78-hour gate". Precision matters less than honesty: a rejected duration is
// null with a reason, never a fabricated number.

export function sanitizeDurationMs(
  raw: number | null,
): { duration_ms: number | null; duration_reason?: 'poisoned_start_ms' } {
  if (raw === null) return { duration_ms: null };
  if (!Number.isFinite(raw) || raw < 0 || raw > MAX_PLAUSIBLE_DURATION_MS) {
    // >6h or negative can only come from a poisoned start_ms (epoch-sized
    // value, unit error) — mark it, don't guess a number.
    return { duration_ms: null, duration_reason: 'poisoned_start_ms' };
  }
  return { duration_ms: raw };
}
