/* ═══════════════════════════════════════════════
   Cash Balance Checker — app.js
   Structure / file-reader scaffold (logic TBD)
   ═══════════════════════════════════════════════ */

'use strict';

/* ── DOM refs ── */
const fileInput      = document.getElementById('file-input');
const uploadPrompt   = document.getElementById('upload-prompt');
const reportPanel    = document.getElementById('report-panel');
const fileNameEl     = document.getElementById('file-name');
const rowCountEl     = document.getElementById('row-count');
const cashierTbody   = document.getElementById('cashier-tbody');
const btnCalculate   = document.getElementById('btn-calculate');
const btnPrint       = document.getElementById('btn-print');
const yearEl         = document.getElementById('year');
const reportDateEl   = document.getElementById('report-date');

/* ── Footer year ── */
yearEl.textContent = new Date().getFullYear();

/* ── Default date to today ── */
reportDateEl.value = new Date().toISOString().split('T')[0];

/* ════════════════════════════════════════════════
   File reading
   ════════════════════════════════════════════════ */
fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();

  reader.onload = (event) => {
    const rawText = event.target.result;
    handleFileLoaded(file.name, rawText);
  };

  reader.onerror = () => {
    alert('Error reading file. Please try again.');
  };

  reader.readAsText(file);
});

/* ════════════════════════════════════════════════
   Handle loaded file content
   ════════════════════════════════════════════════ */
/**
 * Called once the FileReader has finished.
 * @param {string} fileName
 * @param {string} rawText  — raw .txt contents
 */
function handleFileLoaded(fileName, rawText) {
  // Update status bar
  fileNameEl.textContent = fileName;

  // TODO: Parse rawText into cashier records.
  //       For now, generate placeholder rows from the raw lines.
  const lines = rawText
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);

  // Build placeholder cashier rows (structure only)
  const cashiers = parsePlaceholder(lines);

  // Render tables
  renderCashierTable(cashiers);
  renderSummaryTable(cashiers);

  // Show report, hide upload prompt
  uploadPrompt.hidden = true;
  reportPanel.hidden  = false;

  // Update status meta
  rowCountEl.textContent = `${cashiers.length} cashier${cashiers.length !== 1 ? 's' : ''}`;
  btnCalculate.disabled  = false;
}

/* ════════════════════════════════════════════════
   Placeholder parser  (replace with real logic)
   ════════════════════════════════════════════════ */
/**
 * Temporary: treat each non-empty line as a cashier name with zero values.
 * Real implementation will parse structured columns from the .txt format.
 * @param {string[]} lines
 * @returns {CashierRow[]}
 */
function parsePlaceholder(lines) {
  // Minimum of 9 display rows (matching the original form layout)
  const MIN_ROWS = 9;

  const cashiers = lines.map((line, idx) => ({
    name:        line,
    receiptsRs:  0,
    receiptsCts: 0,
    paymentsRs:  0,
    paymentsCts: 0,
  }));

  // Pad with empty rows so the table always shows at least MIN_ROWS
  while (cashiers.length < MIN_ROWS) {
    cashiers.push({ name: '', receiptsRs: 0, receiptsCts: 0, paymentsRs: 0, paymentsCts: 0 });
  }

  return cashiers;
}

/* ════════════════════════════════════════════════
   Render — Cashier table
   ════════════════════════════════════════════════ */
/**
 * @typedef {{ name:string, receiptsRs:number, receiptsCts:number, paymentsRs:number, paymentsCts:number }} CashierRow
 * @param {CashierRow[]} rows
 */
function renderCashierTable(rows) {
  cashierTbody.innerHTML = '';

  let totalRecRs  = 0, totalRecCts  = 0;
  let totalPayRs  = 0, totalPayCts  = 0;

  rows.forEach((row) => {
    const tr = document.createElement('tr');
    if (!row.name) tr.classList.add('empty-row');

    tr.innerHTML = `
      <td>${escHtml(row.name)}</td>
      <td class="num receipts-rs">${fmt(row.receiptsRs)}</td>
      <td class="num cts receipts-cts">${fmtCts(row.receiptsCts)}</td>
      <td class="num payments-rs">${fmt(row.paymentsRs)}</td>
      <td class="num cts payments-cts">${fmtCts(row.paymentsCts)}</td>
    `;

    cashierTbody.appendChild(tr);

    // Accumulate totals (logic placeholder — real math TBD)
    totalRecRs  += row.receiptsRs;
    totalRecCts += row.receiptsCts;
    totalPayRs  += row.paymentsRs;
    totalPayCts += row.paymentsCts;
  });

  // Footer totals
  setCell('total-receipts-rs',  fmt(totalRecRs));
  setCell('total-receipts-cts', fmtCts(totalRecCts));
  setCell('total-payments-rs',  fmt(totalPayRs));
  setCell('total-payments-cts', fmtCts(totalPayCts));
}

/* ════════════════════════════════════════════════
   Render — Summary table
   ════════════════════════════════════════════════ */
/**
 * @param {CashierRow[]} rows
 */
function renderSummaryTable(rows) {
  // TODO: Replace with real balance-brought-forward value from parsed data
  const bbfRs   = 0;
  const bbfCts  = 0;

  const totalRecRs  = rows.reduce((s, r) => s + r.receiptsRs,  0);
  const totalRecCts = rows.reduce((s, r) => s + r.receiptsCts, 0);
  const totalPayRs  = rows.reduce((s, r) => s + r.paymentsRs,  0);
  const totalPayCts = rows.reduce((s, r) => s + r.paymentsCts, 0);

  // Sub-total = BBF + Receipts  (cents carry-over logic TBD)
  const subTotalRs  = bbfRs  + totalRecRs;
  const subTotalCts = bbfCts + totalRecCts;

  // Balance = Sub-total - Payments  (carry-over logic TBD)
  const balRs  = subTotalRs  - totalPayRs;
  const balCts = subTotalCts - totalPayCts;

  setCell('s-bbf-rs',       fmt(bbfRs));
  setCell('s-bbf-cts',      fmtCts(bbfCts));
  setCell('s-receipts-rs',  fmt(totalRecRs));
  setCell('s-receipts-cts', fmtCts(totalRecCts));
  setCell('s-subtotal-rs',  fmt(subTotalRs));
  setCell('s-subtotal-cts', fmtCts(subTotalCts));
  setCell('s-payments-rs',  fmt(totalPayRs));
  setCell('s-payments-cts', fmtCts(totalPayCts));
  setCell('s-balance-rs',   fmt(balRs));
  setCell('s-balance-cts',  fmtCts(balCts));
}

/* ════════════════════════════════════════════════
   Calculate button  (logic stub)
   ════════════════════════════════════════════════ */
btnCalculate.addEventListener('click', () => {
  // TODO: Trigger full calculation pass when logic is implemented.
  console.log('Calculate clicked — logic pending implementation.');
});

/* ════════════════════════════════════════════════
   Print
   ════════════════════════════════════════════════ */
btnPrint.addEventListener('click', () => window.print());

/* ════════════════════════════════════════════════
   Utilities
   ════════════════════════════════════════════════ */

/** Format integer with comma-thousands */
function fmt(n) {
  return Number(n).toLocaleString('en-US');
}

/** Format cents — always two digits */
function fmtCts(n) {
  return String(Math.abs(Number(n))).padStart(2, '0');
}

/** Set text of an element by id */
function setCell(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

/** Escape HTML to prevent XSS from file content */
function escHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
