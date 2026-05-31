import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'fs';
import { join } from 'path';

export interface AuditEntry {
  timestamp: string;
  branch: string;
  commit: string;
  user: string;
  reason: string;
  bypass_type: string;
  gate_count: number;
}

const AUDIT_LOG_FILE = '.audit-log.jsonl';
const MAX_ENTRIES = 100;
const ROLLING_WINDOW_DAYS = 30;
const MAX_BYPASS_THRESHOLD = 3;

export function appendAuditEntry(entry: Omit<AuditEntry, 'gate_count'>, repoRoot: string = process.cwd()): AuditEntry {
  const logPath = join(repoRoot, AUDIT_LOG_FILE);
  const existing = readAllEntries(logPath);
  const gate_count = countRecentBypasses(existing, entry.bypass_type, entry.timestamp);
  
  const fullEntry: AuditEntry = { ...entry, gate_count };
  appendFileSync(logPath, JSON.stringify(fullEntry) + '\n', 'utf8');

  trimLog(logPath);
  return fullEntry;
}

export function readAllEntries(logPath: string = join(process.cwd(), AUDIT_LOG_FILE)): AuditEntry[] {
  if (!existsSync(logPath)) return [];
  const content = readFileSync(logPath, 'utf8').trim();
  if (!content) return [];
  return content.split('\n').map(line => JSON.parse(line) as AuditEntry);
}

export function countBypassesInWindow(entries: AuditEntry[], bypassType: string, windowDays: number = ROLLING_WINDOW_DAYS): number {
  const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  return entries.filter(e => e.bypass_type === bypassType && new Date(e.timestamp) >= cutoff).length;
}

export function exceedsBypassThreshold(entries: AuditEntry[], bypassType: string, threshold: number = MAX_BYPASS_THRESHOLD): { exceeded: boolean; count: number } {
  const count = countBypassesInWindow(entries, bypassType);
  return { exceeded: count > threshold, count };
}

export function formatRetroReport(entries: AuditEntry[], bypassType: string = 'ui-gates'): string {
  const total = entries.filter(e => e.bypass_type === bypassType);
  const count30d = countBypassesInWindow(entries, bypassType);
  const { exceeded } = exceedsBypassThreshold(entries, bypassType);

  let report = `UI Gate Bypass Report (${bypassType})\n`;
  report += `  Last 30 days: ${count30d} bypasses\n`;
  if (exceeded) {
    report += `  ⚠️  EXCEEDS threshold (${MAX_BYPASS_THRESHOLD}) — retro discussion required\n`;
  }
  if (total.length > 0) {
    report += `  Recent bypasses:\n`;
    total.slice(-5).forEach(e => {
      report += `    - ${e.timestamp} | ${e.branch} | ${e.user}: "${e.reason}"\n`;
    });
  }
  return report;
}

function countRecentBypasses(entries: AuditEntry[], bypassType: string, currentTimestamp: string): number {
  const cutoff = new Date(currentTimestamp).getTime() - ROLLING_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return entries.filter(e => e.bypass_type === bypassType && new Date(e.timestamp).getTime() >= cutoff).length;
}

function trimLog(logPath: string): void {
  if (!existsSync(logPath)) return;
  const entries = readAllEntries(logPath);
  if (entries.length > MAX_ENTRIES) {
    const trimmed = entries.slice(-MAX_ENTRIES);
    writeFileSync(logPath, trimmed.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8');
  }
}
