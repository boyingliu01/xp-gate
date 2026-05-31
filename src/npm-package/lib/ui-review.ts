import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { collectUiMatches, parseRenamedFile } from './ui-detector';

const RESULT_FILE = '.ui-gate-result.json';

interface UiReviewResult {
  commit: string;
  verdict: string;
  expires: string;
  design_review: string;
  browser_qa: string;
  ui_changes_detected: string[];
}

function main(): void {
  // eslint-disable-next-line no-console
  console.log('═══ xp-gate ui-review ═══');
  // eslint-disable-next-line no-console
  console.log('');

  // Get staged + modified files
  let files = '';
  try {
    files = execSync('git diff --cached --name-only && git diff --name-only', { encoding: 'utf8' }).trim();
  } catch {
    // eslint-disable-next-line no-console
    console.log('⚠️ No git repo or no changes. Running in current directory.');
  }

  const fileList = files
    .split('\n')
    .map(parseRenamedFile)
    .filter(f => f.length > 0);

  if (fileList.length === 0) {
    // eslint-disable-next-line no-console
    console.log('No files staged or modified. Checking all tracked files.');
    try {
      files = execSync('git ls-files', { encoding: 'utf8' }).trim();
    } catch {
      files = execSync('find . -maxdepth 3 -type f -name "*.ts" -o -name "*.html" -o -name "*.css" -o -name "*.scss" -o -name "*.tsx" -o -name "*.vue" -o -name "*.svelte" 2>/dev/null | grep -v node_modules | grep -v .git', { encoding: 'utf8' }).trim();
    }
    fileList.push(...files.split('\n').filter(f => f.length > 0));
  }

  const result = collectUiMatches(fileList);

  if (!result.isUiSprint) {
    // eslint-disable-next-line no-console
    console.log('ℹ️ No UI changes detected in staged/modified files.');
    // eslint-disable-next-line no-console
    console.log('  Nothing to review. Exiting.');
    process.exit(0);
  }

  // eslint-disable-next-line no-console
  console.log(`🎨 UI changes detected (${result.matchedFiles.length} files):`);
  result.matchedFiles.forEach(f => console.log(`  - ${f}`));
  // eslint-disable-next-line no-console
  console.log('');

  // eslint-disable-next-line no-console
  console.log('Next steps required before push:');
  // eslint-disable-next-line no-console
  console.log('  1. Run /design-review in your AI agent session');
  // eslint-disable-next-line no-console
  console.log('  2. Run /qa or /qa-only in your AI agent session');
  // eslint-disable-next-line no-console
  console.log('  3. Ensure you have .delphi-config.json configured for Delphi review');
  // eslint-disable-next-line no-console
  console.log('');

  const commit = execSync('git rev-parse HEAD 2>/dev/null || echo "no-commit"', { encoding: 'utf8' }).trim();
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const uiResult: UiReviewResult = {
    commit,
    verdict: 'APPROVED',
    expires,
    design_review: 'APPROVED',
    browser_qa: 'APPROVED',
    ui_changes_detected: result.matchedFiles,
  };

  writeFileSync(join(process.cwd(), RESULT_FILE), JSON.stringify(uiResult, null, 2) + '\n', 'utf8');

  // eslint-disable-next-line no-console
  console.log(`✅ Generated ${RESULT_FILE} with APPROVED verdict (template)`);
  // eslint-disable-next-line no-console
  console.log(`   Commit: ${commit}`);
  // eslint-disable-next-line no-console
  console.log(`   Expires: ${expires}`);
  // eslint-disable-next-line no-console
  console.log('');
  // eslint-disable-next-line no-console
  console.log('⚠️  REVIEW THIS FILE before push:');
  // eslint-disable-next-line no-console
  console.log('   - Ensure design_review and browser_qa are actually APPROVED');
  // eslint-disable-next-line no-console
  console.log('   - Edit verdict to REJECTED if issues found');
  // eslint-disable-next-line no-console
  console.log('');
  // eslint-disable-next-line no-console
  console.log('Then: git push (pre-push will validate this file)');
}

main();
