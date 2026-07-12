const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

function readSprintState(dir) {
  try {
    const stateFile = path.join(dir, '.sprint-state', 'sprint-state.json');
    if (!fs.existsSync(stateFile)) return null;
    return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch {
    return null;
  }
}

function getCurrentSprintReqs(state) {
  if (!state?.phase_history) return [];
  const reqs = [];
  for (const phase of state.phase_history) {
    if (phase.reqs) {
      for (const [id, req] of Object.entries(phase.reqs)) {
        reqs.push({ id, name: req.name, status: req.status });
      }
    }
  }
  return reqs;
}

function fetchOpenIssues(repoRoot) {
  try {
    const result = childProcess.execSync('gh issue list --state open --json number,title,labels,createdAt', {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 30000,
    });
    return JSON.parse(result);
  } catch (err) {
    if (err.message.includes('gh: command not found')) {
      console.error('Error: gh CLI not found. Install it from https://cli.github.com/');
      return null;
    }
    if (err.message.includes('not logged in')) {
      console.error('Error: Not logged in to GitHub. Run "gh auth login" first.');
      return null;
    }
    console.error('Error fetching issues:', err.message);
    return null;
  }
}

function filterRemainingIssues(issues, sprintReqs) {
  const sprintTitles = new Set(sprintReqs.map(r => r.name?.toLowerCase()));
  return issues.filter(issue => {
    const titleLower = issue.title.toLowerCase();
    return !sprintTitles.has(titleLower);
  });
}

function formatIssuesTable(issues) {
  if (issues.length === 0) return 'No remaining issues found.';
  const lines = ['Remaining Open Issues:', ''];
  lines.push('┌──────┬────────────────────────────────────────────┬─────────────────────┬───────────┐');
  lines.push('│ #    │ Title                                      │ Labels              │ Created   │');
  lines.push('├──────┼────────────────────────────────────────────┼─────────────────────┼───────────┤');
  for (const issue of issues) {
    const num = String(issue.number).padEnd(4);
    const title = issue.title.slice(0, 40).padEnd(40);
    const labels = (issue.labels || []).map(l => l.name).join(', ').slice(0, 19).padEnd(19);
    const created = issue.createdAt ? issue.createdAt.slice(0, 10) : 'N/A';
    lines.push(`│ ${num} │ ${title} │ ${labels} │ ${created} │`);
  }
  lines.push('└──────┴────────────────────────────────────────────┴─────────────────────┴───────────┘');
  lines.push(`Total: ${issues.length} remaining issues`);
  return lines.join('\n');
}

function generateSprintPlan(issues) {
  if (issues.length === 0) return null;
  const lines = ['Suggested Next Sprint Plan:', ''];
  const prioritized = issues.slice(0, 5);
  for (let i = 0; i < prioritized.length; i++) {
    const issue = prioritized[i];
    lines.push(`${i + 1}. #${issue.number} - ${issue.title}`);
  }
  if (issues.length > 5) {
    lines.push(`... and ${issues.length - 5} more issues`);
  }
  lines.push('');
  lines.push('To start a sprint, run:');
  lines.push(`  /sprint-flow "Implement #${prioritized[0].number}: ${prioritized[0].title}"`);
  return lines.join('\n');
}

async function handleNextSprint(args = []) {
  const jsonFlag = args.includes('--json');
  const planFlag = args.includes('--plan');
  const dirIdx = args.indexOf('--dir');
  let repoRoot = process.cwd();
  if (dirIdx >= 0 && dirIdx + 1 < args.length) {
    repoRoot = path.resolve(args[dirIdx + 1]);
  }
  const state = readSprintState(repoRoot);
  const sprintReqs = state ? getCurrentSprintReqs(state) : [];
  const issues = fetchOpenIssues(repoRoot);
  if (issues === null) return 1;
  const remaining = filterRemainingIssues(issues, sprintReqs);
  if (jsonFlag) {
    console.log(JSON.stringify({ current_sprint: state?.id || null, sprint_reqs: sprintReqs, remaining_issues: remaining }, null, 2));
    return 0;
  }
  console.log(formatIssuesTable(remaining));
  if (planFlag) {
    const plan = generateSprintPlan(remaining);
    if (plan) {
      console.log('');
      console.log(plan);
    }
  }
  return 0;
}

module.exports = {
  handleNextSprint,
  fetchOpenIssues,
  filterRemainingIssues,
  formatIssuesTable,
  generateSprintPlan,
  readSprintState,
  getCurrentSprintReqs,
};
