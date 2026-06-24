/**
 * XP-Gate OpenCode TUI Slot Plugin
 *
 * Registers sidebar_content slot to display Sprint Flow progress
 * from active sprint states discovered in .worktrees/sprint/ subdirectories.
 *
 * This is a separate plugin file because SDK 1.x PluginModule does not
 * support server + tui in the same module. Users register this file
 * in ~/.config/opencode/tui.json as:
 *   { "plugin": ["@boyingliu01/opencode-plugin/tui"] }
 *
 * The npm package exports "./tui" from package.json for this resolution.
 *
 * Discovery logic is inlined here (mirrors src/npm-package/lib/sprint-discovery.js)
 * because the plugin ships separately from the CLI package at runtime.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join, dirname, resolve, parse } from "node:path"
import { homedir } from "node:os"
import type { TuiPlugin, TuiSlotPlugin, TuiSlotProps } from "@opencode-ai/plugin/tui"

// ── Phase constants (inlined from ../../src/npm-package/lib/shared-phase-constants.js) ──

const PHASE_NAMES: Record<string, string> = {
  '-1': 'ISOLATE',
  '-0.5': 'AUTO-ESTIMATE',
  '0': 'THINK',
  '1': 'PLAN',
  '2': 'BUILD',
  '3': 'REVIEW',
  '4': 'USER ACCEPT',
  '5': 'FEEDBACK',
  '6': 'SHIP',
  '7': 'LAND',
  '8': 'CLEANUP',
};

const PHASE_ORDER = ['-1', '-0.5', '0', '1', '2', '3', '4', '5', '6', '7', '8'];

// ── Sprint state schema ──

interface SprintReq {
  name?: string
  status?: "completed" | "in_progress" | "pending"
}

interface SprintPhaseHistory {
  phase: number | string
  phase_name?: string
  status?: "completed" | "in_progress" | "pending"
  started_at?: string
  completed_at?: string
  duration_seconds?: number
  reqs?: Record<string, SprintReq>
}

interface SprintState {
  id?: string
  phase?: number | string
  status?: string
  started_at?: string
  task_description?: string
  isolation?: { branch?: string; worktree_path?: string }
  metrics?: { tests_passed?: number; tests_failed?: number; coverage_pct?: number }
  phase_history?: SprintPhaseHistory[]
}

interface DiscoveredSprint {
  state: SprintState
  sourcePath: string
  worktreeExists: boolean
}

// ── Discovery: inlined from src/npm-package/lib/sprint-discovery.js ──

const MAX_DISCOVERY_RESULTS = 5;

function findGitRoot(startDir: string): string | null {
  let current = resolve(startDir);
  const root = parse(current).root;
  const seen = new Set<string>();

  while (current !== root) {
    if (seen.has(current)) break;
    seen.add(current);
    if (existsSync(join(current, '.git'))) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  if (existsSync(join(root, '.git'))) return root;
  return null;
}

function readSprintState(dir: string): SprintState | null {
  try {
    const stateFile = join(dir, '.sprint-state', 'sprint-state.json');
    if (!existsSync(stateFile)) return null;
    return JSON.parse(readFileSync(stateFile, 'utf8')) as SprintState;
  } catch {
    return null;
  }
}

function checkWorktreeExists(worktreePath: string | undefined): boolean {
  if (!worktreePath) return false;
  try { return existsSync(worktreePath); } catch { return false; }
}

function discoverActiveSprints(dir: string): DiscoveredSprint[] {
  const gitRoot = findGitRoot(dir);
  const results: DiscoveredSprint[] = [];

  if (gitRoot) {
    const worktreeBase = join(gitRoot, '.worktrees', 'sprint');
    let entries: { name: string; isDirectory: () => boolean }[] = [];
    try {
      if (existsSync(worktreeBase)) {
        entries = readdirSync(worktreeBase, { withFileTypes: true });
      }
    } catch { /* EACCES */ }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const sprintDir = join(worktreeBase, entry.name);
      const state = readSprintState(sprintDir);
      if (!state?.id) continue;
      const worktreeExists = checkWorktreeExists(sprintDir);
      if (isStaleSprint(state) && !worktreeExists) continue;

      results.push({ state, sourcePath: join(sprintDir, '.sprint-state', 'sprint-state.json'), worktreeExists });
    }
  }

  // Fallback: cwd's own .sprint-state/
  const localState = readSprintState(dir);
  if (localState?.id) {
    const localWorktreePath = localState.isolation?.worktree_path;
    const hasExplicitWorktree = !!localWorktreePath;
    const localWorktreeExists = hasExplicitWorktree ? checkWorktreeExists(localWorktreePath) : false;
    if (!hasExplicitWorktree || localWorktreeExists) {
      results.push({
        state: localState,
        sourcePath: join(dir, '.sprint-state', 'sprint-state.json'),
        worktreeExists: localWorktreeExists,
      });
    }
  }

  // Dedup by state.id
  const deduped = new Map<string, DiscoveredSprint>();
  for (const entry of results) {
    const id = entry.state.id!;
    const existing = deduped.get(id);
    if (!existing) { deduped.set(id, entry); continue; }
    if (entry.worktreeExists && !existing.worktreeExists) { deduped.set(id, entry); continue; }
    if (!entry.worktreeExists && existing.worktreeExists) continue;
    const entryTs = entry.state.started_at ? new Date(entry.state.started_at).getTime() : 0;
    const existingTs = existing.state.started_at ? new Date(existing.state.started_at).getTime() : 0;
    if (entryTs > existingTs || (entryTs === existingTs && entry.sourcePath < existing.sourcePath)) {
      deduped.set(id, entry);
    }
  }

  return Array.from(deduped.values())
    .sort((a, b) => {
      const aTs = a.state.started_at ? new Date(a.state.started_at).getTime() : 0;
      const bTs = b.state.started_at ? new Date(b.state.started_at).getTime() : 0;
      if (bTs !== aTs) return bTs - aTs;
      return String(b.state.id).localeCompare(String(a.state.id));
    })
    .slice(0, MAX_DISCOVERY_RESULTS);
}

// ── Cache (module-level, 5s TTL) ──

let _cache: { data: DiscoveredSprint[]; upgradeNotice: string | null; ts: number; dir: string } | null = null;
const CACHE_TTL_MS = 5_000;

// ── Helpers ──

function parseTime(value: unknown): number {
  return new Date(value as string).getTime();
}

function sprintTimestamp(state: SprintState): number {
  if (!state.started_at) return 0;
  const started = parseTime(state.started_at);
  if (isNaN(started)) return 0;
  let latest = started;
  if (Array.isArray(state.phase_history)) {
    for (const ph of state.phase_history) {
      latest = ph.completed_at ? Math.max(latest, parseTime(ph.completed_at)) : latest;
      latest = ph.started_at ? Math.max(latest, parseTime(ph.started_at)) : latest;
    }
  }
  return latest;
}

function isStaleSprint(state: SprintState | null): boolean {
  if (!state?.started_at) return false;
  const latest = sprintTimestamp(state);
  return latest > 0 && Date.now() - latest > 3_600_000;
}

function statusSymbol(status: string | undefined, key: string, currentPhase: string | number | undefined): string {
  if (status === "completed") return "✓"
  if (status === "in_progress") return "→"
  if (String(currentPhase) === key) return "·"
  return "○"
}

function renderPhaseLine(key: string, history: SprintPhaseHistory | undefined, currentPhase: string | number | undefined): string {
  const name = history?.phase_name || PHASE_NAMES[key] || key
  const status = history?.status || (String(currentPhase) === key ? "in_progress" : "pending")
  const sym = statusSymbol(status, key, currentPhase)
  return `${sym} ${name.padEnd(14)} ${status === "completed" ? "done" : status === "in_progress" ? "active" : ""}`
    .replace(/\s+$/, "")
}

function buildPhaseLookup(state: SprintState): Record<string, SprintPhaseHistory> {
  const lookup: Record<string, SprintPhaseHistory> = {}
  if (Array.isArray(state.phase_history)) {
    for (const ph of state.phase_history) {
      lookup[String(ph.phase)] = ph
    }
  }
  return lookup
}

function buildMetricsLine(metrics: SprintState["metrics"]): string | null {
  const parts: string[] = []
  if (metrics?.tests_passed != null) parts.push(`tests:${metrics.tests_passed}`)
  if (metrics?.coverage_pct != null) parts.push(`cov:${metrics.coverage_pct}%`)
  return parts.length > 0 ? parts.join(" ") : null
}

function buildStaleWarning(state: SprintState): string | null {
  if (!state?.started_at) return null
  return isStaleSprint(state) ? "⚠ idle >1h" : null
}

function renderBuildReqs(history: SprintPhaseHistory): string[] {
  if (!history.reqs) return []
  return Object.entries(history.reqs)
    .filter(([, r]) => r.name)
    .map(([id, r]) => `  ${statusSymbol(r.status, id, undefined)} ${r.name}`)
}

function appendBuildReqs(lines: string[], key: string, history: SprintPhaseHistory | undefined): void {
  if (key === "2" && history?.reqs) {
    lines.push(...renderBuildReqs(history))
  }
}

function renderPhaseLines(
  historyByPhase: Record<string, SprintPhaseHistory>,
  currentPhase: string | number | undefined,
): string[] {
  const lines: string[] = []
  for (const key of PHASE_ORDER) {
    const history = historyByPhase[key]
    if (!history && String(currentPhase) !== key) continue
    lines.push(renderPhaseLine(key, history, currentPhase))
    appendBuildReqs(lines, key, history)
  }
  return lines
}

function renderSprintSidebar(state: SprintState): string {
  if (!state || !state.task_description) return ""

  const lines: string[] = [`SPRINT: ${state.task_description}`]
  const metricsLine = buildMetricsLine(state.metrics)
  if (metricsLine) lines.push(metricsLine)

  const staleWarning = buildStaleWarning(state)
  if (staleWarning) lines.push(staleWarning)

  const historyByPhase = buildPhaseLookup(state)
  lines.push(...renderPhaseLines(historyByPhase, state.phase))

  return lines.join("\n")
}

function renderSprintTitle(state: SprintState): string {
  if (state.task_description) return state.task_description;
  if (state.id) {
    // Fallback: extract date from sprint ID like "sprint-2026-06-23-01"
    const match = state.id.match(/sprint-(\d{4}-\d{2}-\d{2})-(\d+)/);
    if (match) return `Sprint ${match[1]} #${match[2]}`;
    return state.id;
  }
  return 'Unknown Sprint';
}

function renderMultiSprintSidebar(sprints: DiscoveredSprint[]): string | null {
  if (sprints.length === 0) return null;

  const blocks: string[] = [];
  const displayCount = Math.min(sprints.length, 3);

  for (let i = 0; i < displayCount; i++) {
    const { state } = sprints[i];
    const title = renderSprintTitle(state);
    const block: string[] = [`SPRINT: ${title}`];

    if (state.isolation?.branch) {
      block.push(`  ${state.isolation.branch}`);
    }

    const metricsLine = buildMetricsLine(state.metrics);
    if (metricsLine) block.push(`  ${metricsLine}`);

    const staleWarning = buildStaleWarning(state);
    if (staleWarning) block.push(`  ${staleWarning}`);

    const historyByPhase = buildPhaseLookup(state);
    block.push(...renderPhaseLines(historyByPhase, state.phase));

    blocks.push(block.join("\n"));
  }

  if (sprints.length > 3) {
    blocks.push(`… +${sprints.length - 3} more`);
  }

  return blocks.join("\n---\n");
}

function renderContent(sprints: DiscoveredSprint[], upgradeNotice: string | null, dir: string): string | null {
  const sprintContent = renderMultiSprintSidebar(sprints)

  if (sprintContent) {
    return [upgradeNotice, sprintContent].filter(Boolean).join("\n---\n")
  }

  // Early-phase placeholders: when no sprint data yet, check for directory hints
  const hasStateDir = existsSync(join(dir, ".sprint-state"))
  const gitRoot = findGitRoot(dir)
  const hasWorktreesRoot = gitRoot ? existsSync(join(gitRoot, ".worktrees")) : false

  if (hasStateDir) {
    const placeholder = "SPRINT FLOW\n  → 初始化中..."
    return [upgradeNotice, placeholder].filter(Boolean).join("\n---\n")
  }

  if (hasWorktreesRoot) {
    const placeholder = "SPRINT FLOW\n  · 准备中..."
    return [upgradeNotice, placeholder].filter(Boolean).join("\n---\n")
  }

  return upgradeNotice || null
}

// ── Upgrade notice ──

const UPGRADE_NOTICE_FILE = join(homedir(), ".xp-gate", "upgrade-notice.json")
const UPGRADE_NOTICE_TTL_MS = 86_400_000 // 24h

type UpgradeNotice = {
  kind: string
  localVersion: string | null
  remoteVersion: string | null
  message: string
  ts: number
}

function readUpgradeNotice(): UpgradeNotice | null {
  try {
    if (!existsSync(UPGRADE_NOTICE_FILE)) return null
    const raw = readFileSync(UPGRADE_NOTICE_FILE, "utf8")
    const data = JSON.parse(raw) as UpgradeNotice
    if (Date.now() - data.ts < UPGRADE_NOTICE_TTL_MS && data.message) return data
    return null
  } catch {
    return null
  }
}

function renderUpgradeNotice(): string | null {
  const notice = readUpgradeNotice()
  if (!notice) return null
  const icon = notice.kind === "upgraded" ? "✓" : notice.kind === "outdated" ? "↑" : "⚠"
  return `${icon} ${notice.message}`
}

// ── TUI Slot Plugin ──

const tuiPlugin: TuiSlotPlugin = {
  slots: {
    sidebar_content: (_props: TuiSlotProps) => {
      const dir = process.env.XP_GATE_PROJECT_DIR || process.cwd();
      const now = Date.now();

      if (_cache && _cache.dir === dir && now - _cache.ts < CACHE_TTL_MS) {
        return renderContent(_cache.data, _cache.upgradeNotice, dir);
      }

      const sprints = discoverActiveSprints(dir);
      const upgradeNotice = renderUpgradeNotice()
      _cache = { data: sprints, ts: now, dir, upgradeNotice };
      return renderContent(sprints, upgradeNotice, dir);
    },
  },
}

// Wrap as TuiPlugin (async factory)
const plugin: TuiPlugin = async (api, _options, _meta) => {
  api.slots.register(tuiPlugin)
}

export { plugin as tui, readSprintState, renderSprintSidebar }
