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
   
  console.log('═══ xp-gate ui-review ═══');
   
  console.log('');

  // Get staged + modified files
  let files = '';
  try {
    files = execSync('git diff --cached --name-only && git diff --name-only', { encoding: 'utf8' }).trim();
  } catch {
     
    console.log('⚠️ No git repo or no changes. Running in current directory.');
  }

  const fileList = files
    .split('\n')
    .map(parseRenamedFile)
    .filter(f => f.length > 0);

  if (fileList.length === 0) {
     
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

   
  console.log(`✅ Generated ${RESULT_FILE} with APPROVED verdict (template)`);
   
  console.log(`   Commit: ${commit}`);
   
  console.log(`   Expires: ${expires}`);
   
  console.log('');
   
  console.log('⚠️  REVIEW THIS FILE before push:');
   
  console.log('   - Ensure design_review and browser_qa are actually APPROVED');
   
  console.log('   - Edit verdict to REJECTED if issues found');
   
  console.log('');
   
  console.log('Then: git push (pre-push will validate this file)');
}

main();
