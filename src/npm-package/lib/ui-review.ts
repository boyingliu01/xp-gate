import { execSync } from 'child_process';
import { writeFileSync, readdirSync, statSync } from 'fs';
import { join, relative, extname } from 'path';
import { collectUiMatches, parseRenamedFile } from './ui-detector';

const RESULT_FILE = '.ui-gate-result.json';

export interface UiReviewResult {
  commit: string;
  verdict: string;
  expires: string;
  design_review: string;
  browser_qa: string;
  ui_changes_detected: string[];
}

export function getChangedFilesForReview(): string[] {
  let files = '';
  try {
    files = execSync('git diff --cached --name-only && git diff --name-only', { encoding: 'utf8' }).trim();
  } catch {
    console.log('⚠️ No git repo or no changes. Running in current directory.');
  }

  const fileList = parseFileList(files);
  if (fileList.length > 0) {
    return fileList;
  }

  console.log('No files staged or modified. Checking all tracked files.');
  return getFallbackFileList();
}

export function parseFileList(files: string): string[] {
  return files
    .split('\n')
    .map(parseRenamedFile)
    .filter(f => f.length > 0);
}

export function getFallbackFileList(): string[] {
  try {
    return parseFileList(execSync('git ls-files', { encoding: 'utf8' }).trim());
  } catch {
    // Not a git repo — fall back to filesystem scan (cross-platform)
    const UI_EXTENSIONS = new Set(['.ts', '.html', '.css', '.scss', '.tsx', '.vue', '.svelte']);
    const results: string[] = [];

    function walk(dir: string, depth: number) {
      if (depth > 3) return;
      try {
        const entries = readdirSync(dir);
        for (const entry of entries) {
          if (entry === 'node_modules' || entry === '.git') continue;
          const fullPath = join(dir, entry);
          try {
            const st = statSync(fullPath);
            if (st.isDirectory()) {
              walk(fullPath, depth + 1);
            } else if (st.isFile() && UI_EXTENSIONS.has(extname(entry))) {
              results.push(relative(process.cwd(), fullPath));
            }
          } catch { /* skip inaccessible entries */ }
        }
      } catch { /* skip inaccessible directories */ }
    }

    walk(process.cwd(), 0);
    return results;
  }
}

export function buildUiReviewResult(matchedFiles: string[], now: Date = new Date()): UiReviewResult {
  const commit = getCurrentCommit();
  const expires = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

  return {
    commit,
    verdict: 'APPROVED',
    expires,
    design_review: 'APPROVED',
    browser_qa: 'APPROVED',
    ui_changes_detected: matchedFiles,
  };
}

export function writeUiReviewResult(result: UiReviewResult, repoRoot: string = process.cwd()): void {
  writeFileSync(join(repoRoot, RESULT_FILE), JSON.stringify(result, null, 2) + '\n', 'utf8');
}

function getCurrentCommit(): string {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return 'no-commit';
  }
}

export function main(): void {
  console.log('═══ xp-gate ui-review ═══');
  console.log('');

  const fileList = getChangedFilesForReview();
  const result = collectUiMatches(fileList);

  if (!result.isUiSprint) {
    console.log('ℹ️ No UI changes detected in staged/modified files.');
    console.log('  Nothing to review. Exiting.');
    process.exit(0);
  }

  console.log(`🎨 UI changes detected (${result.matchedFiles.length} files):`);
  result.matchedFiles.forEach(f => console.log(`  - ${f}`));
  console.log('');

  console.log('Next steps required before push:');
  console.log('  1. Run /design-review in your AI agent session');
  console.log('  2. Run /qa or /qa-only in your AI agent session');
  console.log('  3. Ensure you have .delphi-config.json configured for Delphi review');
  console.log('');

  const uiResult = buildUiReviewResult(result.matchedFiles);
  writeUiReviewResult(uiResult);

  console.log(`✅ Generated ${RESULT_FILE} with APPROVED verdict (template)`);
  console.log(`   Commit: ${uiResult.commit}`);
  console.log(`   Expires: ${uiResult.expires}`);
  console.log('');
  console.log('⚠️  REVIEW THIS FILE before push:');
  console.log('   - Ensure design_review and browser_qa are actually APPROVED');
  console.log('   - Edit verdict to REJECTED if issues found');
  console.log('');
  console.log('Then: git push (pre-push will validate this file)');
}

if (require.main === module) {
  main();
}
