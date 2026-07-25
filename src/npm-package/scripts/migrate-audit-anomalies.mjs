#!/usr/bin/env node
/**
 * Issue #370: One-time migration to mark existing anomalous audit records.
 *
 * Scans .xp-gate/audit.jsonl for entries where duration_ms > max_duration_ms
 * (default 7200000ms = 2h, configurable via .xp-gate-config.json audit.max_duration_ms)
 * and adds `duration_anomaly: true` to those entries.
 *
 * Original duration_ms values are PRESERVED — never clamped or modified.
 *
 * Usage: node src/npm-package/scripts/migrate-audit-anomalies.mjs [--dry-run]
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const repoRoot = process.cwd();
const auditPath = join(repoRoot, '.xp-gate', 'audit.jsonl');
const configPath = join(repoRoot, '.xp-gate-config.json');
const dryRun = process.argv.includes('--dry-run');

// Read max_duration_ms from config (default 7200000)
let maxDurationMs = 7200000;
if (existsSync(configPath)) {
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    if (config.audit && typeof config.audit.max_duration_ms === 'number') {
      maxDurationMs = config.audit.max_duration_ms;
    }
  } catch {
    // Use default
  }
}

if (!existsSync(auditPath)) {
  console.log(`No audit log found at ${auditPath} — nothing to migrate.`);
  process.exit(0);
}

const content = readFileSync(auditPath, 'utf8');
const lines = content.split('\n');
let markedCount = 0;
let alreadyMarked = 0;
const updatedLines = [];

for (const line of lines) {
  if (!line.trim()) {
    updatedLines.push(line);
    continue;
  }
  try {
    const entry = JSON.parse(line);
    if (entry.duration_ms > maxDurationMs) {
      if (entry.duration_anomaly === true) {
        alreadyMarked++;
      } else {
        entry.duration_anomaly = true;
        markedCount++;
      }
    }
    updatedLines.push(JSON.stringify(entry));
  } catch {
    // Preserve malformed lines as-is
    updatedLines.push(line);
  }
}

if (dryRun) {
  console.log(`[DRY RUN] Would mark ${markedCount} records with duration_anomaly: true`);
  console.log(`[DRY RUN] Already marked: ${alreadyMarked}`);
  console.log(`[DRY RUN] Threshold: duration_ms > ${maxDurationMs}`);
} else {
  writeFileSync(auditPath, updatedLines.join('\n'), 'utf8');
  console.log(`Migration complete:`);
  console.log(`  Marked ${markedCount} records with duration_anomaly: true`);
  console.log(`  Already marked: ${alreadyMarked}`);
  console.log(`  Threshold: duration_ms > ${maxDurationMs}`);
  console.log(`  File: ${auditPath}`);
}
