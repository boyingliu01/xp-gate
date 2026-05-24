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
  const avgScore = (history.reduce((sum, h) => sum + (h.score || 0), 0) / totalRuns).toFixed(1);
  
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
  const labels = history.map(h => {
    const d = new Date(h.timestamp);
    return `${d.getMonth()+1}/${d.getDate()}`;
  });
  
  new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Quality Score',
        data: history.map(h => h.score),
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: 4,
        pointHoverRadius: 6
      }]
    },
    options: {
      responsive: true,
      scales: {
        y: { min: 0, max: 10, ticks: { stepSize: 2 } }
      },
      plugins: {
        legend: { display: false }
      }
    }
  });
}

function renderGatePassRateChart(history) {
  if (!history.length) return;
  
  // Extract all gate names
  const gateNames = ['Gate 1: Code Quality', 'Gate 2: Duplicate Code', 'Gate 3: Complexity',
    'Gate 4: Principles', 'Gate 5: Tests+Coverage', 'Gate 6: Architecture',
    'Gate 7: IaC Security', 'Gate 8: Secret Scanning', 'Gate 9: SAST Security'];
  
  // Calculate pass rate per gate
  const passRates = gateNames.map(name => {
    // Try to find the gate key from history
    const gateKey = Object.keys(history[0].gates || {}).find(k => {
      const g = history[0].gates[k];
      return g && g.name && name.includes(g.name.replace('+', ''));
    });
    if (!gateKey) return 0;
    
    let passCount = 0;
    for (const h of history) {
      const g = (h.gates || {})[gateKey];
      if (g && (g.status === 'PASS' || g.status === 'SKIP')) passCount++;
    }
    return Math.round((passCount / history.length) * 100);
  });
  
  const ctx = document.getElementById('gate-pass-chart').getContext('2d');
  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: gateNames.map(n => n.split(': ')[0]),
      datasets: [{
        label: 'Pass Rate (%)',
        data: passRates,
        backgroundColor: passRates.map(r => r >= 90 ? 'rgba(34,197,94,0.7)' : r >= 50 ? 'rgba(234,179,8,0.7)' : 'rgba(239,68,68,0.7)'),
        borderColor: passRates.map(r => r >= 90 ? '#22c55e' : r >= 50 ? '#eab308' : '#ef4444'),
        borderWidth: 1,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      scales: {
        y: { min: 0, max: 100, ticks: { callback: v => v + '%' } }
      },
      plugins: { legend: { display: false } }
    }
  });
}

function renderMetricsChart(history) {
  if (!history.length) return;
  
  const hasComplexity = history.some(h => h.complexityWarnings > 0);
  const hasBoyScout = history.some(h => h.boyScoutBlocked > 0);
  
  if (!hasComplexity && !hasBoyScout) {
    document.getElementById('metrics-section').style.display = 'none';
    return;
  }
  
  const labels = history.map(h => {
    const d = new Date(h.timestamp);
    return `${d.getMonth()+1}/${d.getDate()}`;
  });
  
  const datasets = [];
  if (hasComplexity) {
    datasets.push({
      label: 'Complexity Warnings',
      data: history.map(h => h.complexityWarnings || 0),
      borderColor: '#f97316',
      backgroundColor: 'rgba(249,115,22,0.1)',
      fill: false,
      tension: 0.3,
      yAxisID: 'y'
    });
  }
  if (hasBoyScout) {
    datasets.push({
      label: 'Boy Scout Blocked',
      data: history.map(h => h.boyScoutBlocked || 0),
      borderColor: '#ef4444',
      backgroundColor: 'rgba(239,68,68,0.1)',
      fill: false,
      tension: 0.3,
      yAxisID: 'y'
    });
  }
  
  const ctx = document.getElementById('metrics-chart').getContext('2d');
  new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      scales: { y: { beginAtZero: true } },
      plugins: { legend: { position: 'top' } }
    }
  });
}

async function exportPDF() {
  const { jsPDF } = window.jspdf;
  const autoTable = window.jspdfAutoTable;
  
  const doc = new jsPDF();
  const history = await loadHistory();
  if (!history.length) {
    alert('No data to export.');
    return;
  }
  
  const latest = history[history.length - 1];
  const avgScore = (history.reduce((sum, h) => sum + (h.score || 0), 0) / history.length).toFixed(1);
  
  // Title
  doc.setFontSize(20);
  doc.text('XP-Gate Quality Report', 14, 22);
  
  // Summary
  doc.setFontSize(12);
  doc.text(`Generated: ${new Date().toLocaleDateString()}`, 14, 32);
  doc.text(`Total Runs: ${history.length} | Avg Score: ${avgScore}/10 | Latest: ${latest.score}/10`, 14, 40);
  
  // Gate table
  const gateNames = ['Gate 1: Code Quality', 'Gate 2: Duplicate Code', 'Gate 3: Complexity',
    'Gate 4: Principles', 'Gate 5: Tests+Coverage', 'Gate 6: Architecture',
    'Gate 7: IaC Security', 'Gate 8: Secret Scanning', 'Gate 9: SAST Security'];
  
  const rows = gateNames.map(name => {
    const gateKey = Object.keys(latest.gates || {}).find(k => {
      const g = latest.gates[k];
      return g && g.name && name.includes(g.name.split('+')[0]);
    });
    const status = gateKey ? (latest.gates[gateKey]?.status || 'N/A') : 'N/A';
    return [name, status];
  });
  
  autoTable(doc, {
    startY: 50,
    head: [['Gate', 'Status']],
    body: rows,
    theme: 'grid',
    headStyles: { fillColor: [59, 130, 246] },
    styles: { fontSize: 9 }
  });
  
  // Score history
  const finalY = doc.lastAutoTable.finalY + 10;
  doc.text('Score History', 14, finalY);
  
  const scoreRows = history.slice(-20).map(h => [
    new Date(h.timestamp).toLocaleDateString(),
    h.score.toString(),
    `${h.passed}/${h.total} gates`
  ]);
  
  autoTable(doc, {
    startY: finalY + 5,
    head: [['Date', 'Score', 'Gates']],
    body: scoreRows,
    theme: 'grid',
    headStyles: { fillColor: [59, 130, 246] },
    styles: { fontSize: 9 }
  });
  
  doc.save(`xp-gate-quality-${latest.commit.slice(0,7)}.pdf`);
}

function setupExportButton() {
  const btn = document.getElementById('export-pdf');
  if (btn) btn.addEventListener('click', exportPDF);
}

async function init() {
  const history = await loadHistory();
  
  if (!history.length) {
    document.getElementById('summary-cards').innerHTML = '<p>No history data available. Run some commits first.</p>';
    return;
  }
  
  renderSummary(history);
  renderScoreChart(history);
  renderGatePassRateChart(history);
  renderMetricsChart(history);
  setupExportButton();
}

init();
