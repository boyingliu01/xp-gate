export const MARK = {
  PASS: 'PASS',
  WARN: 'WARN',
  FAIL: 'FAIL',
  SKIP: 'SKIP',
  INFO: 'INFO',
};

export function section(title) {
  console.log(`\n=== ${title} ===`);
}

export function item(status, text) {
  console.log(`  [${status}] ${text}`);
}

export function note(text) {
  console.log(`         ${text}`);
}

/** 纯 ASCII 表格；中文列宽会偏，但保证不乱码。 */
export function table(headers, rows) {
  const cells = [headers, ...rows].map((row) => row.map((v) => String(v ?? '')));
  const widths = headers.map((_, i) => Math.max(...cells.map((row) => row[i].length)));
  const render = (row) => row.map((v, i) => v.padEnd(widths[i])).join('  ');
  console.log(`  ${render(cells[0])}`);
  console.log(`  ${widths.map((w) => '-'.repeat(w)).join('  ')}`);
  for (const row of cells.slice(1)) console.log(`  ${render(row)}`);
}
