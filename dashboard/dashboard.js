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
