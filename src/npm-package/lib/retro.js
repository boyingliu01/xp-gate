/**
 * xp-gate retro — Sprint engineering retrospective CLI (#369, design §8.1)
 *
 * Reads git log + .xp-gate/audit.jsonl + .quality-history.jsonl + .sprint-history/
 * and generates a Markdown retrospective report with rework rate trend (#369)
 * and --skip-evidence exposure (§8.4) sections.
 *
 * Zero npm dependencies (Node built-ins only).
 * @module retro
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Get git commit subjects within a date window.
 * @param {string} dir - Repository root
 * @param {number} days - Lookback window in days
 * @returns {Array<{hash: string, date: string, subject: string}>}
 */
function getGitCommits(dir, days) {
  try {
    const out = execSync(
      `git log --since="${days} days ago" --pretty=format:"%H|%ai|%s"`,
      { cwd: dir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return out.split('\n').filter(Boolean).map(l => {
      const [hash, date, ...rest] = l.split('|');
      return { hash, date, subject: rest.join('|') };
    });
  } catch {
    return [];
  }
}

/**
 * Parse .xp-gate/audit.jsonl entries.
 * @param {string} dir - Repository root
 * @returns {object[]} Parsed audit entries
 */
function readAuditEntries(dir) {
  const p = path.join(dir, '.xp-gate', 'audit.jsonl');
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n')
    .filter(l => l.trim())
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

/**
 * Read last 10 entries from .quality-history.jsonl.
 * @param {string} dir - Repository root
 * @returns {object[]} Recent quality entries
 */
function readQualityHistory(dir) {
  const p = path.join(dir, '.quality-history.jsonl');
  if (!fs.existsSync(p)) return [];
  const entries = fs.readFileSync(p, 'utf8').split('\n')
    .filter(l => l.trim())
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
  return entries.slice(-10);
}

/**
 * Read sprint history JSON files from .sprint-state/sprint-history/.
 * @param {string} dir - Repository root
 * @param {string|null} sprintFilter - Optional sprint ID filter
 * @returns {object[]} Sprint state objects
 */
function readSprintHistory(dir, sprintFilter) {
  const histDir = path.join(dir, '.sprint-state', 'sprint-history');
  const results = [];
  if (fs.existsSync(histDir)) {
    for (const f of fs.readdirSync(histDir).filter(f => f.endsWith('.json'))) {
      try {
        const s = JSON.parse(fs.readFileSync(path.join(histDir, f), 'utf8'));
        if (!sprintFilter || s.id === sprintFilter) results.push(s);
      } catch { /* skip */ }
    }
  }
  return results;
}

/**
 * Build the Markdown retrospective report.
 * @param {object} opts - Report data
 * @returns {string} Markdown report
 */
function buildReport(opts) {
  const { days, commits, audit, quality, sprints } = opts;
  const now = new Date();
  const start = new Date(now.getTime() - days * 86400000);
  const L = [];

  L.push('# Sprint Engineering Retrospective');
  L.push('');
  L.push(`Period: ${start.toISOString().slice(0, 10)} to ${now.toISOString().slice(0, 10)}`);
  L.push('');

  // Activity Summary
  L.push('## Activity Summary');
  const gateEntries = audit.filter(e => e.gate_id);
  const passed = gateEntries.filter(e => e.passed).length;
  const normal = gateEntries.filter(e => !e.duration_anomaly);
  const anomalous = gateEntries.length - normal.length;
  const avgMs = normal.length > 0
    ? Math.round(normal.reduce((s, e) => s + (e.duration_ms || 0), 0) / normal.length)
    : 0;
  L.push(`- Total commits in window: ${commits.length}`);
  L.push(`- Sprint transitions recorded: ${sprints.length}`);
  L.push(`- Gate pass rate: ${gateEntries.length > 0 ? ((passed / gateEntries.length) * 100).toFixed(1) : '0.0'}% (${gateEntries.length} gates total, ${gateEntries.length - passed} failed)`);
  if (gateEntries.length > 0) {
    L.push(`- Avg gate duration: ${avgMs}ms (${anomalous} anomal${anomalous === 1 ? 'y' : 'ies'} excluded)`);
  }
  L.push('');

  // Rework Rate Trend (#369)
  L.push('## Rework Rate Trend (#369)');
  const withRate = sprints.filter(s => s.metrics && s.metrics.rework_rate != null);
  if (withRate.length === 0) {
    L.push('No data');
  } else {
    L.push('| Sprint | Rework Rate | Fix Commits | Total Commits |');
    L.push('|--------|-------------|-------------|---------------|');
    for (const s of withRate) {
      const pct = (s.metrics.rework_rate * 100).toFixed(1);
      const fix = s.metrics.total_sprint_commits != null
        ? Math.round(s.metrics.rework_rate * s.metrics.total_sprint_commits)
        : '?';
      L.push(`| ${s.id || 'unknown'} | ${pct}% | ${fix} | ${s.metrics.total_sprint_commits ?? '?'} |`);
      if (s.metrics.rework_rate > 0.30) {
        L.push(`⚠️ Sprint ${s.id || 'unknown'}: ${pct}% rework — exceeds 30% threshold`);
      }
    }
  }
  L.push('');

  // Evidence Skip Exposure (§8.4)
  L.push('## Evidence Skip Exposure (§8.4)');
  const skipped = audit.filter(e => e.event === 'evidence_skipped');
  if (skipped.length === 0) {
    L.push('No data');
  } else {
    L.push('| Phase | Reason | Timestamp |');
    L.push('|-------|--------|-----------|');
    for (const e of skipped) {
      L.push(`| ${e.phase || '?'} | ${e.reason || '?'} | ${(e.timestamp || '').slice(0, 19)} |`);
    }
    const bySprint = {};
    for (const e of skipped) {
      const k = e.sprint_id || 'unknown';
      bySprint[k] = (bySprint[k] || 0) + 1;
    }
    for (const [sid, count] of Object.entries(bySprint)) {
      if (count > 2) {
        L.push(`⚠️ Sprint ${sid} used skip ${count} times`);
      }
    }
  }
  L.push('');

  // Quality Trend
  L.push('## Quality Trend');
  if (quality.length === 0) {
    L.push('No data');
  } else {
    for (const q of quality) {
      L.push(`- ${(q.timestamp || '').slice(0, 10)}: score ${q.score ?? '?'}`);
    }
  }

  return L.join('\n');
}

/**
 * CLI entry point for xp-gate retro.
 * @param {string[]} args - CLI subargs (without 'retro')
 * @returns {Promise<number>} Exit code
 */
async function handleRetro(args = []) {
  const allFlag = args.includes('--all');
  const jsonFlag = args.includes('--json');
  const daysIdx = args.indexOf('--days');
  const sprintIdx = args.indexOf('--sprint');

  let days = allFlag ? 30 : 7;
  if (daysIdx >= 0 && args[daysIdx + 1]) {
    days = parseInt(args[daysIdx + 1], 10);
    if (isNaN(days) || days < 1) days = 7;
  }

  const sprintFilter = (sprintIdx >= 0 && args[sprintIdx + 1]) ? args[sprintIdx + 1] : null;
  const dir = process.cwd();

  const commits = getGitCommits(dir, days);
  const audit = readAuditEntries(dir);
  const quality = readQualityHistory(dir);
  const sprints = readSprintHistory(dir, sprintFilter);

  if (jsonFlag) {
    const gateEntries = audit.filter(e => e.gate_id);
    const passed = gateEntries.filter(e => e.passed).length;
    console.log(JSON.stringify({
      period: { days, from: new Date(Date.now() - days * 86400000).toISOString(), to: new Date().toISOString() },
      total_commits: commits.length,
      gate_pass_rate: gateEntries.length > 0 ? passed / gateEntries.length : null,
      rework_rates: sprints.filter(s => s.metrics?.rework_rate != null).map(s => ({ id: s.id, rate: s.metrics.rework_rate })),
      evidence_skipped: audit.filter(e => e.event === 'evidence_skipped'),
      quality: quality.map(q => ({ timestamp: q.timestamp, score: q.score })),
    }, null, 2));
    return 0;
  }

  console.log(buildReport({ days, commits, audit, quality, sprints }));
  return 0;
}

module.exports = { handleRetro };
