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
  // #507 S3 made `score` a number-or-null (SKIP-ALL -> null) and added
  // `effectiveTotal`/`skipCount`. Average and display over numeric scores
  // only -- `null || 0` used to drag SKIP-ALL runs in as fake zeros, and a
  // null latest score rendered as a red "fail" (#507 Delphi round-1 A-MAJOR-3).
  const scored = history.filter(h => typeof h.score === 'number');
  const avgScore = scored.length
    ? (scored.reduce((sum, h) => sum + h.score, 0) / scored.length).toFixed(1)
    : 'N/A';
  const latestScore = typeof latest.score === 'number' ? latest.score : null;
  const latestClass = latestScore === null ? 'skip' : latestScore >= 8 ? 'pass' : latestScore >= 5 ? 'skip' : 'fail';
  const latestText = latestScore === null ? 'N/A (all gates skipped)' : `${latestScore}/10`;

  document.getElementById('summary-cards').innerHTML = `
    <div class="card">
      <h3>Total Runs</h3>
      <div class="value">${totalRuns}</div>
    </div>
    <div class="card">
      <h3>Average Score</h3>
      <div class="value">${avgScore}${typeof avgScore === 'number' || avgScore === 'N/A' ? '' : '/10'}</div>
    </div>
    <div class="card">
      <h3>Latest Score</h3>
      <div class="value ${latestClass}">${latestText}</div>
    </div>
    <div class="card">
      <h3>Gates Passed</h3>
      <div class="value">${latest.passed}/${latest.effectiveTotal ?? latest.total}${latest.skipCount ? ' <small>(' + latest.skipCount + ' skipped)</small>' : ''}</div>
    </div>
  `;
}

/**
 * Chart.js options for the dashboard's simple charts: responsive, one y scale,
 * no legend. Factored out because every chart here repeats it, and inlining it
 * is what pushed each renderer's nesting past the limit.
 */
function chartOptions(yAxis) {
  return {
    responsive: true,
    scales: { y: yAxis },
    plugins: { legend: { display: false } },
  };
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
    options: chartOptions({ min: 0, max: 10, ticks: { stepSize: 2 } }),
  });
}

/** The chart's gate labels, in display order. */
const GATE_CHART_LABELS = ['Gate 1: Code Quality', 'Gate 2: Duplicate Code', 'Gate 3: Complexity',
  'Gate 4: Principles', 'Gate 5: Tests+Coverage', 'Gate 6: Architecture',
  'Gate 7: IaC Security', 'Gate 8: Secret Scanning', 'Gate 9: SAST Security'];

/**
 * Find the report key whose gate name best matches a chart label.
 *
 * The label and the reported name are both human text and differ slightly
 * ("Tests+Coverage" vs "Tests & Coverage"), so the match is "one contains the
 * other with '+' removed" rather than equality.
 *
 * @param {object} gates the gates object from the newest report
 * @param {string} label chart label
 * @returns {string|undefined} matching key, if any
 */
function findGateKey(gates, label) {
  return Object.keys(gates || {}).find((key) => {
    const gate = gates[key];
    return gate && gate.name && label.includes(gate.name.replace('+', ''));
  });
}

/**
 * Percentage of reports in which `gateKey` passed or was skipped.
 * A skipped gate is not a failure, so it counts as a pass here.
 *
 * @param {Array<object>} history reports, newest first
 * @param {string} gateKey gate key
 * @returns {number} 0-100
 */
function passRateFor(history, gateKey) {
  const passes = history.filter((report) => {
    const gate = (report.gates || {})[gateKey];
    return gate && (gate.status === 'PASS' || gate.status === 'SKIP');
  }).length;
  return Math.round((passes / history.length) * 100);
}

/** Colour tiers for a pass rate: green at 90%+, amber at 50%+, red below. */
const PASS_RATE_TIERS = [
  { min: 90, fill: 'rgba(34,197,94,0.7)', stroke: '#22c55e' },
  { min: 50, fill: 'rgba(234,179,8,0.7)', stroke: '#eab308' },
  { min: -Infinity, fill: 'rgba(239,68,68,0.7)', stroke: '#ef4444' },
];

/** The tier a pass rate falls into. */
function passRateTier(rate) {
  return PASS_RATE_TIERS.find((tier) => rate >= tier.min);
}

/**
 * Chart.js config for the gate pass-rate bars.
 *
 * Kept separate from the render call so the config literal is not nested inside
 * a function that also does lookups and DOM work — that combination is what made
 * the renderer hard to scan.
 */
function gatePassRateChartConfig(passRates) {
  return {
    type: 'bar',
    data: {
      labels: GATE_CHART_LABELS.map(n => n.split(': ')[0]),
      datasets: [{
        label: 'Pass Rate (%)',
        data: passRates,
        backgroundColor: passRates.map(r => passRateTier(r).fill),
        borderColor: passRates.map(r => passRateTier(r).stroke),
        borderWidth: 1,
        borderRadius: 4
      }]
    },
    options: chartOptions({ min: 0, max: 100, ticks: { callback: v => v + '%' } }),
  };
}

function renderGatePassRateChart(history) {
  if (!history.length) return;

  // Calculate pass rate per gate
  const passRates = GATE_CHART_LABELS.map(label => {
    const gateKey = findGateKey(history[0].gates, label);
    return gateKey ? passRateFor(history, gateKey) : 0;
  });

  const ctx = document.getElementById('gate-pass-chart').getContext('2d');
  new Chart(ctx, gatePassRateChartConfig(passRates));
}

/** One line dataset for the metrics chart. */
function metricsDataset(label, color, values) {
  return {
    label,
    data: values,
    borderColor: color,
    backgroundColor: `${color}1a`,
    fill: false,
    tension: 0.3,
    yAxisID: 'y',
  };
}

/**
 * Chart.js options for a multi-dataset chart: responsive, zero-based y,
 * top legend. Split from the config so neither object nests five levels deep.
 */
function metricsChartOptions() {
  const legend = { position: 'top' };
  return {
    responsive: true,
    scales: { y: { beginAtZero: true } },
    plugins: { legend },
  };
}

/** Chart.js config for the metrics chart. */
function metricsChartConfig(labels, datasets) {
  return {
    type: 'line',
    data: { labels, datasets },
    options: metricsChartOptions(),
  };
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
    datasets.push(metricsDataset('Complexity Warnings', '#f97316',
      history.map(h => h.complexityWarnings || 0)));
  }
  if (hasBoyScout) {
    datasets.push(metricsDataset('Boy Scout Blocked', '#ef4444',
      history.map(h => h.boyScoutBlocked || 0)));
  }

  const ctx = document.getElementById('metrics-chart').getContext('2d');
  new Chart(ctx, metricsChartConfig(labels, datasets));
}

/**
 * Average and latest score for the PDF header.
 *
 * Same number-or-null contract as renderSummary (#507 S3): a null score means
 * SKIP-ALL. Only numeric scores enter the average (no fake zeros), a null latest
 * renders as N/A, and nothing calls a method on null.
 */
function pdfScoreSummary(history) {
  const scored = history.filter(h => typeof h.score === 'number');
  const avg = scored.length
    ? (scored.reduce((sum, h) => sum + h.score, 0) / scored.length).toFixed(1)
    : 'N/A';
  const latestScore = typeof history[history.length - 1].score === 'number'
    ? history[history.length - 1].score
    : null;
  return {
    avgText: avg === 'N/A' ? 'N/A' : `${avg}/10`,
    latestText: latestScore === null ? 'N/A' : `${latestScore}/10`,
  };
}

/** The [{ gate, status }] rows for the PDF gate table. */
function pdfGateRows(latest) {
  return GATE_CHART_LABELS.map(name => {
    const gateKey = findGateKey(latest.gates, name);
    const status = gateKey ? (latest.gates[gateKey]?.status || 'N/A') : 'N/A';
    return [name, status];
  });
}

/** The last 20 score rows for the PDF score-history table. */
function pdfScoreRows(history) {
  return history.slice(-20).map(h => [
    new Date(h.timestamp).toLocaleDateString(),
    typeof h.score === 'number' ? String(h.score) : 'N/A',
    h.passed + '/' + (h.effectiveTotal ?? h.total) + ' gates'
  ]);
}

/** Shared table styling for both PDF tables. */
function pdfTableStyles() {
  return {
    theme: 'grid',
    headStyles: { fillColor: [59, 130, 246] },
    styles: { fontSize: 9 },
  };
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
  const { avgText, latestText } = pdfScoreSummary(history);

  doc.setFontSize(20);
  doc.text('XP-Gate Quality Report', 14, 22);

  doc.setFontSize(12);
  doc.text(`Generated: ${new Date().toLocaleDateString()}`, 14, 32);
  doc.text(`Total Runs: ${history.length} | Avg Score: ${avgText} | Latest: ${latestText}`, 14, 40);

  // Same labels and same "which report key matches this label" lookup as the
  // pass-rate chart, so both reuse the shared table and findGateKey.
  autoTable(doc, {
    startY: 50,
    head: [['Gate', 'Status']],
    body: pdfGateRows(latest),
    ...pdfTableStyles(),
  });

  const finalY = doc.lastAutoTable.finalY + 10;
  doc.text('Score History', 14, finalY);

  autoTable(doc, {
    startY: finalY + 5,
    head: [['Date', 'Score', 'Gates']],
    body: pdfScoreRows(history),
    ...pdfTableStyles(),
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
