// @no-test-required: TUI rendering plugin — tested via visual verification in OpenCode runtime
/**
 * XP-Gate OpenCode TUI Slot Plugin
 *
 * Registers sidebar_content slot to display Sprint Flow progress
 * from active sprint states discovered in .worktrees/sprint/ subdirectories.
 *
 * Rendered with @opentui/solid JSX — sidebar_content must return JSX.Element,
 * NOT string (strings are silently ignored by OpenCode's TUI renderer).
 *
 * Users register this file in ~/.config/opencode/tui.json as:
 *   { "plugin": ["@boyingliu01/opencode-plugin/tui"] }
 */
/** @jsxImportSource @opentui/solid */

import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join, dirname, resolve, parse } from "node:path"
import { homedir } from "node:os"
import type { TuiPlugin, TuiSlotPlugin, TuiSlotProps } from "@opencode-ai/plugin/tui"
import { createMemo, Show, For } from "solid-js"

// ── Phase constants ──

const PHASE_NAMES: Record<string, string> = {
  '-1': 'ISOLATE', '-0.5': 'AUTO-ESTIMATE', '0': 'THINK',
  '1': 'PLAN', '2': 'BUILD', '3': 'REVIEW',
  '4': 'SHIP', '5': 'LAND', '6': 'USER ACCEPT',
  '7': 'FEEDBACK', '8': 'CLEANUP',
};

const PHASE_ORDER = ['-1', '-0.5', '0', '1', '2', '3', '4', '5', '6', '7', '8'];

// ── Types ──

interface SprintReq {
  name?: string
  status?: "completed" | "in_progress" | "pending"
}
interface SprintPhaseHistory {
  phase: number | string
  phase_name?: string
  status?: "completed" | "in_progress" | "pending"
  started_at?: string; completed_at?: string
  duration_seconds?: number
  reqs?: Record<string, SprintReq>
}
interface SprintState {
  id?: string; phase?: number | string; status?: string; started_at?: string
  task_description?: string
  isolation?: { branch?: string; worktree_path?: string }
  metrics?: { tests_passed?: number; tests_failed?: number; coverage_pct?: number }
  phase_history?: SprintPhaseHistory[]
}
interface DiscoveredSprint {
  state: SprintState; sourcePath: string; worktreeExists: boolean
}

// ── Discovery ──

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
    const sf = join(dir, '.sprint-state', 'sprint-state.json');
    if (!existsSync(sf)) return null;
    return JSON.parse(readFileSync(sf, 'utf8')) as SprintState;
  } catch { return null; }
}

function checkWorktreeExists(p: string | undefined): boolean {
  if (!p) return false;
  try { return existsSync(p); } catch { return false; }
}

function parseTime(v: unknown): number {
  return new Date(v as string).getTime();
}

function isStaleSprint(s: SprintState | null): boolean {
  if (!s?.started_at) return false;
  let latest = parseTime(s.started_at);
  if (isNaN(latest)) return false;
  for (const ph of s.phase_history ?? []) {
    if (ph.completed_at) latest = Math.max(latest, parseTime(ph.completed_at));
    if (ph.started_at) latest = Math.max(latest, parseTime(ph.started_at));
  }
  return latest > 0 && Date.now() - latest > 3_600_000;
}

function discoverActiveSprints(dir: string): DiscoveredSprint[] {
  const gitRoot = findGitRoot(dir);
  const results: DiscoveredSprint[] = [];

  if (gitRoot) {
    const base = join(gitRoot, '.worktrees', 'sprint');
    let entries: { name: string; isDirectory: () => boolean }[] = [];
    try { if (existsSync(base)) entries = readdirSync(base, { withFileTypes: true }); } catch { /* ok */ }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const d = join(base, e.name);
      const state = readSprintState(d);
      if (!state?.id) continue;
      const wt = checkWorktreeExists(d);
      if (isStaleSprint(state) && !wt) continue;
      results.push({ state, sourcePath: join(d, '.sprint-state', 'sprint-state.json'), worktreeExists: wt });
    }
  }

  const localState = readSprintState(dir);
  if (localState?.id) {
    const wp = localState.isolation?.worktree_path;
    const hasWp = !!wp;
    const wt = hasWp ? checkWorktreeExists(wp) : false;
    if (!hasWp || wt) results.push({ state: localState, sourcePath: join(dir, '.sprint-state', 'sprint-state.json'), worktreeExists: wt });
  }

  const deduped = new Map<string, DiscoveredSprint>();
  for (const e of results) {
    const id = e.state.id!;
    const existing = deduped.get(id);
    if (!existing) { deduped.set(id, e); continue; }
    if (e.worktreeExists && !existing.worktreeExists) { deduped.set(id, e); continue; }
    if (!e.worktreeExists && existing.worktreeExists) continue;
    const eTs = e.state.started_at ? new Date(e.state.started_at).getTime() : 0;
    const xTs = existing.state.started_at ? new Date(existing.state.started_at).getTime() : 0;
    if (eTs > xTs || (eTs === xTs && e.sourcePath < existing.sourcePath)) deduped.set(id, e);
  }

  return Array.from(deduped.values())
    .sort((a, b) => {
      const aTs = a.state.started_at ? new Date(a.state.started_at).getTime() : 0;
      const bTs = b.state.started_at ? new Date(b.state.started_at).getTime() : 0;
      return bTs - aTs || String(b.state.id).localeCompare(String(a.state.id));
    })
    .slice(0, MAX_DISCOVERY_RESULTS);
}

// ── Cache ──

let _cache: { data: DiscoveredSprint[]; upgradeNotice: string | null; ts: number; dir: string } | null = null;
const CACHE_TTL_MS = 5_000;

// ── Render helpers ──

function statusSymbol(status: string | undefined, currentPhase: string | number | undefined, key: string): string {
  if (status === "completed") return "✓"
  if (status === "in_progress") return "→"
  if (String(currentPhase) === key) return "·"
  return "○"
}

function buildPhaseLookup(state: SprintState): Record<string, SprintPhaseHistory> {
  const lookup: Record<string, SprintPhaseHistory> = {}
  for (const ph of state.phase_history ?? []) lookup[String(ph.phase)] = ph
  return lookup
}

function phaseLine(key: string, history: SprintPhaseHistory | undefined, currentPhase: string | number | undefined): string {
  const name = history?.phase_name || PHASE_NAMES[key] || key
  const st = history?.status || (String(currentPhase) === key ? "in_progress" : "pending")
  const sym = statusSymbol(st, currentPhase, key)
  const suffix = st === "completed" ? "done" : st === "in_progress" ? "active" : ""
  return `${sym} ${name.padEnd(14)} ${suffix}`.replace(/\s+$/, "")
}

function renderSprintTitle(state: SprintState): string {
  if (state.task_description) return state.task_description;
  if (state.id) {
    const m = state.id.match(/sprint-(\d{4}-\d{2}-\d{2})-(\d+)/);
    return m ? `Sprint ${m[1]} #${m[2]}` : state.id;
  }
  return 'Unknown Sprint';
}

// ── Upgrade notice ──

const UPGRADE_NOTICE_FILE = join(homedir(), ".xp-gate", "upgrade-notice.json")
const UPGRADE_NOTICE_TTL_MS = 86_400_000

function readUpgradeNotice(): string | null {
  try {
    if (!existsSync(UPGRADE_NOTICE_FILE)) return null
    const raw = JSON.parse(readFileSync(UPGRADE_NOTICE_FILE, "utf8"))
    if (Date.now() - raw.ts < UPGRADE_NOTICE_TTL_MS && raw.message) {
      const icon = raw.kind === "upgraded" ? "✓" : raw.kind === "outdated" ? "↑" : "⚠"
      return `${icon} ${raw.message}`
    }
    return null
  } catch { return null; }
}

// ── JSX Components ──

function SprintCard(props: { sprint: DiscoveredSprint }) {
  const { state } = props.sprint
  const lookup = buildPhaseLookup(state)

  return (
    <box>
      <text><b>SPRINT:</b> {renderSprintTitle(state)}</text>
      <Show when={state.isolation?.branch}>
        {(branch: () => string) => <text fg="#888888">  {branch()}</text>}
      </Show>
      <Show when={state.metrics?.tests_passed != null || state.metrics?.coverage_pct != null}>
        <text fg="#888888">
          {state.metrics?.tests_passed != null ? `tests:${state.metrics.tests_passed}` : ""}
          {state.metrics?.coverage_pct != null ? ` cov:${state.metrics.coverage_pct}%` : ""}
        </text>
      </Show>
      <Show when={isStaleSprint(state)}>
        <text fg="#ffaa00">  ⚠ idle >1h</text>
      </Show>
      <For each={PHASE_ORDER}>
        {(key: string) => {
          const hist = lookup[key]
          if (!hist && String(state.phase) !== key) return null
          return <text>{phaseLine(key, hist, state.phase)}</text>
        }}
      </For>
    </box>
  )
}

function SprintSidebar(props: { sprints: DiscoveredSprint[] }) {
  const display = props.sprints.slice(0, 3)

  return (
    <box>
      <For each={display}>
        {(sprint: DiscoveredSprint, i: () => number) => (
          <>
            <Show when={i() > 0}>
              <text>---</text>
            </Show>
            <SprintCard sprint={sprint} />
          </>
        )}
      </For>
      <Show when={props.sprints.length > 3}>
        <text>... +{props.sprints.length - 3} more</text>
      </Show>
    </box>
  )
}

function renderContent(sprints: DiscoveredSprint[], upgradeNotice: string | null, dir: string) {
  const components: any[] = []

  if (sprints.length > 0) {
    if (upgradeNotice) components.push(<text>{upgradeNotice}</text>)
    components.push(<SprintSidebar sprints={sprints} />)
    return components.length > 1 ? <box>{components}</box> : components[0]
  }

  const hasStateDir = existsSync(join(dir, ".sprint-state"))
  const gitRoot = findGitRoot(dir)
  const hasWorktreesRoot = gitRoot ? existsSync(join(gitRoot, ".worktrees")) : false

  if (hasStateDir) return <box>{upgradeNotice ? <text>{upgradeNotice}</text> : null}<text><b>SPRINT FLOW</b></text><text>  -> Initializing...</text></box>
  if (hasWorktreesRoot) return <box>{upgradeNotice ? <text>{upgradeNotice}</text> : null}<text><b>SPRINT FLOW</b></text><text>  · Ready...</text></box>
  if (upgradeNotice) return <box><text>{upgradeNotice}</text></box>

  return null
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
      const upgradeNotice = readUpgradeNotice()
      _cache = { data: sprints, ts: now, dir, upgradeNotice };
      return renderContent(sprints, upgradeNotice, dir);
    },
  },
}

const plugin: TuiPlugin = async (api, _options, _meta) => {
  api.slots.register(tuiPlugin)
}

export { plugin as tui, readSprintState }
