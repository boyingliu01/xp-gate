# Web Dashboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a lightweight local web dashboard to visualize Gate scan history, pass/fail trends, and security findings from local JSON data.

**Architecture:** Static HTML/CSS/JS single-page app served locally. Reads from `quality-report.json` and `.quality-history.jsonl` files. No external dependencies or build tools - pure vanilla JS for zero overhead.

**Tech Stack:** Vanilla HTML/CSS/JS, Chart.js (CDN), Node.js http-server (optional)

---

### Task 1: Dashboard HTML Structure

**Files:**
- Create: `dashboard/index.html`

**Step 1: Create HTML skeleton**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>XP-Gate Quality Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header>
    <h1>XP-Gate Quality Dashboard</h1>
    <p class="subtitle">Local scan history and trends</p>
  </header>
  
  <main>
    <section class="summary">
      <h2>Summary</h2>
      <div id="summary-cards"></div>
    </section>
    
    <section class="charts">
      <h2>Score Trend</h2>
      <canvas id="score-chart"></canvas>
    </section>
    
    <section class="gates">
      <h2>Gate History</h2>
      <div id="gate-table"></div>
    </section>
  </main>
  
  <script src="dashboard.js"></script>
</body>
</html>
```

**Step 2: Commit**

```bash
git add dashboard/index.html
git commit -m "feat(#47): add dashboard HTML structure"
```

---

### Task 2: Dashboard Styles

**Files:**
- Create: `dashboard/style.css`

**Step 1: Create CSS styles**

```css
:root {
  --bg: #0f172a;
  --card: #1e293b;
  --text: #e2e8f0;
  --text-muted: #94a3b8;
  --pass: #22c55e;
  --fail: #ef4444;
  --skip: #f59e0b;
  --border: #334155;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: system-ui, -apple-system, sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.6;
}

header {
  padding: 2rem;
  text-align: center;
  border-bottom: 1px solid var(--border);
}

h1 {
  font-size: 2rem;
  font-weight: 600;
}

.subtitle {
  color: var(--text-muted);
  margin-top: 0.5rem;
}

main {
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem;
}

section {
  margin-bottom: 2rem;
}

h2 {
  font-size: 1.5rem;
  margin-bottom: 1rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid var(--border);
}

#summary-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1rem;
}

.card {
  background: var(--card);
  padding: 1.5rem;
  border-radius: 8px;
  border: 1px solid var(--border);
}

.card h3 {
  font-size: 0.875rem;
  color: var(--text-muted);
  margin-bottom: 0.5rem;
}

.card .value {
  font-size: 2rem;
  font-weight: 700;
}

.card .value.pass { color: var(--pass); }
.card .value.fail { color: var(--fail); }
.card .value.skip { color: var(--skip); }

#score-chart {
  background: var(--card);
  padding: 1.5rem;
  border-radius: 8px;
  border: 1px solid var(--border);
}

#gates {
  background: var(--card);
  padding: 1.5rem;
  border-radius: 8px;
  border: 1px solid var(--border);
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th, td {
  padding: 0.75rem;
  text-align: left;
  border-bottom: 1px solid var(--border);
}

th {
  color: var(--text-muted);
  font-weight: 500;
}

.status {
  display: inline-block;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
}

.status.pass {
  background: rgba(34, 197, 94, 0.2);
  color: var(--pass);
}

.status.fail {
  background: rgba(239, 68, 68, 0.2);
  color: var(--fail);
}

.status.skip {
  background: rgba(245, 158, 11, 0.2);
  color: var(--skip);
}
```

**Step 2: Commit**

```bash
git add dashboard/style.css
git commit -m "feat(#47): add dashboard styles"
```

---

### Task 3: Dashboard JavaScript - Data Loading

**Files:**
- Create: `dashboard/dashboard.js`

**Step 1: Create data loading logic**

```javascript
// dashboard.js - XP-Gate Quality Dashboard

async function loadHistory() {
  try {
    const response = await fetch('.quality-history.jsonl');
    const text = await response.text();
    return text
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line));
  } catch (err) {
    console.warn('Failed to load history:', err);
    return [];
  }
}

async function loadReport() {
  try {
    const response = await fetch('quality-report.json');
    return await response.json();
  } catch (err) {
    console.warn('Failed to load report:', err);
    return null;
  }
}

function renderSummary(history) {
  if (!history.length) return;
  
  const latest = history[history.length - 1];
  const totalRuns = history.length;
  const avgScore = (history.reduce((sum, h) => sum + h.score, 0) / totalRuns).toFixed(1);
  
  document.getElementById('summary-cards').innerHTML = `
    <div class="card">
      <h3>Total Runs</h3>
      <div class="value">${totalRuns}</div>
    </div>
    <div class="card">
      <h3>Average Score</h3>
      <div class="value">${avgScore}/10</div>
    </div>
    <div class="card">
      <h3>Latest Score</h3>
      <div class="value ${latest.score >= 8 ? 'pass' : latest.score >= 5 ? 'skip' : 'fail'}">${latest.score}/10</div>
    </div>
    <div class="card">
      <h3>Gates Passed</h3>
      <div class="value">${latest.passed}/${latest.total}</div>
    </div>
  `;
}

function renderScoreChart(history) {
  const ctx = document.getElementById('score-chart').getContext('2d');
  
  new Chart(ctx, {
    type: 'line',
    data: {
      labels: history.map(h => new Date(h.timestamp).toLocaleDateString()),
      datasets: [{
        label: 'Quality Score',
        data: history.map(h => h.score),
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        fill: true,
        tension: 0.3
      }]
    },
    options: {
      responsive: true,
      scales: {
        y: {
          min: 0,
          max: 10
        }
      }
    }
  });
}

function renderGateTable(history) {
  if (!history.length) return;
  
  const latest = history[history.length - 1];
  const report = latest.gates || {};
  
  let html = '<table><thead><tr>';
  html += '<th>Gate</th><th>Status</th>';
  html += '</tr></thead><tbody>';
  
  for (const [key, gate] of Object.entries(report)) {
    const status = gate.status || 'unknown';
    const statusClass = status === 'PASS' ? 'pass' : status === 'FAIL' ? 'fail' : 'skip';
    
    html += `<tr>
      <td>${gate.name || key}</td>
      <td><span class="status ${statusClass}">${status}</span></td>
    </tr>`;
  }
  
  html += '</tbody></table>';
  document.getElementById('gate-table').innerHTML = html;
}

async function init() {
  const history = await loadHistory();
  const report = await loadReport();
  
  if (!history.length) {
    document.getElementById('summary-cards').innerHTML = '<p>No history data available. Run some commits first.</p>';
    return;
  }
  
  renderSummary(history);
  renderScoreChart(history);
  renderGateTable(history);
}

init();
```

**Step 2: Commit**

```bash
git add dashboard/dashboard.js
git commit -m "feat(#47): add dashboard JavaScript with data loading and rendering"
```

---

### Task 4: Serve Script

**Files:**
- Create: `dashboard/serve.js`

**Step 1: Create Node.js serve script**

```javascript
#!/usr/bin/env node
// Serve dashboard locally
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const DIR = path.join(__dirname, '..');

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json'
};

const server = http.createServer((req, res) => {
  let filePath = path.join(DIR, req.url === '/' ? 'dashboard/index.html' : req.url);
  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'text/plain';
  
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Dashboard running at http://localhost:${PORT}`);
  console.log(`Press Ctrl+C to stop`);
});
```

**Step 2: Add npm script to package.json**

Add to `package.json` scripts:
```json
"dashboard": "node dashboard/serve.js"
```

**Step 3: Commit**

```bash
git add dashboard/serve.js package.json
git commit -m "feat(#47): add dashboard serve script and npm script"
```

---

### Task 5: Documentation

**Files:**
- Modify: `README.md`

**Step 1: Add dashboard section to README**

Add to README after Quality Gates section:

```markdown
### Web Dashboard

View scan history and trends locally:

```bash
npm run dashboard
# Open http://localhost:3000
```

Dashboard reads from:
- `.quality-history.jsonl` — Score history per commit
- `quality-report.json` — Latest gate details
```

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs(#47): add dashboard usage to README"
```

---

### Task 6: Verification

**Step 1: Test dashboard loads**

```bash
npm run dashboard &
sleep 2
curl -s http://localhost:3000 | head -20
# Should show HTML content
pkill -f "node dashboard/serve.js"
```

**Step 2: Final commit**

```bash
git commit --amend -m "feat(#47): implement Web Dashboard for quality scan history"
```
