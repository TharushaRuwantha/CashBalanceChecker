/* ═══════════════════════════════════════════════
   Cash Balance Checker — app.js
   ═══════════════════════════════════════════════ */

'use strict';

/* ── DOM refs ── */
const fileInput      = document.getElementById('file-input');
const uploadPrompt   = document.getElementById('upload-prompt');
const reportPanel    = document.getElementById('report-panel');
const fileNameEl     = document.getElementById('file-name');
const rowCountEl     = document.getElementById('row-count');
const cashierTbody   = document.getElementById('cashier-tbody');
const rawTbody       = document.getElementById('raw-tbody');
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
function handleFileLoaded(fileName, rawText) {
  fileNameEl.textContent = fileName;

  const lines = rawText
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);

  const { records, grandTotal } = parseTextFile(lines);

  // Render raw data table
  renderRawTable(records);

  // Teller subtotals (type=1) excluding the dummy grand-total teller (teller=0)
  const tellerRows = records.filter(r => r.type === 1 && r.teller !== '0');

  // Build cashier rows
  const cashiers = tellerRows.map(r => {
    const recRaw = r.tlbf02;
    const payRaw = r.tlbf16;
    return {
      name:        r.teller,
      receiptsRs:  Math.floor(recRaw / 100),
      receiptsCts: recRaw % 100,
      paymentsRs:  Math.floor(payRaw / 100),
      paymentsCts: payRaw % 100,
    };
  });

  // Pad to at least 9 rows
  while (cashiers.length < 9) {
    cashiers.push({ name: '', receiptsRs: 0, receiptsCts: 0, paymentsRs: 0, paymentsCts: 0 });
  }

  renderCashierTable(cashiers);
  renderSummaryTable(grandTotal);

  // Show report, hide upload prompt
  uploadPrompt.hidden = true;
  reportPanel.hidden  = false;

  rowCountEl.textContent = `${tellerRows.length} cashier${tellerRows.length !== 1 ? 's' : ''}`;
  btnCalculate.disabled  = false;
}

/* ════════════════════════════════════════════════
   Parser — reads the fixed-column .txt format
   ════════════════════════════════════════════════
   File columns (space-separated):
     [0] type     — 2=detail, 1=teller subtotal, 0=grand total
     [1] teller   — teller number
     [2] currency — 100 / 200 / 105 / 0
     [3] tlbf01
     [4] tlbf02
     [5] tlbf15
     [6] tlbf16
   ════════════════════════════════════════════════ */
function parseTextFile(lines) {
  const records = [];
  let grandTotal = null;

  lines.forEach(line => {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 7) return;

    const record = {
      type:     parseInt(parts[0], 10),
      teller:   parts[1],
      currency: parts[2],
      tlbf01:   parseInt(parts[3], 10) || 0,
      tlbf02:   parseInt(parts[4], 10) || 0,
      tlbf15:   parseInt(parts[5], 10) || 0,
      tlbf16:   parseInt(parts[6], 10) || 0,
    };

    records.push(record);

    if (record.type === 0) {
      grandTotal = record;
    }
  });

  return { records, grandTotal };
}

/* ════════════════════════════════════════════════
   Render — Raw Data table
   ════════════════════════════════════════════════ */
function renderRawTable(records) {
  rawTbody.innerHTML = '';

  records.forEach(rec => {
    const tr = document.createElement('tr');

    // Row style based on type
    if (rec.type === 0) {
      tr.classList.add('raw-grand-total');
    } else if (rec.type === 1) {
      tr.classList.add('raw-subtotal');
    }

    tr.innerHTML = `
      <td class="col-type-cell type-${rec.type}">${rec.type}</td>
      <td class="col-teller-cell">${escHtml(rec.teller)}</td>
      <td class="col-currency-cell">${escHtml(rec.currency)}</td>
      <td class="num">${fmtBig(rec.tlbf01)}</td>
      <td class="num">${fmtBig(rec.tlbf02)}</td>
      <td class="num">${fmtBig(rec.tlbf15)}</td>
      <td class="num">${fmtBig(rec.tlbf16)}</td>
    `;

    rawTbody.appendChild(tr);
  });
}

/* ════════════════════════════════════════════════
   Render — Cashier table
   ════════════════════════════════════════════════ */
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

    totalRecRs  += row.receiptsRs;
    totalRecCts += row.receiptsCts;
    totalPayRs  += row.paymentsRs;
    totalPayCts += row.paymentsCts;
  });

  // Carry-over cents into Rs
  totalRecRs  += Math.floor(totalRecCts / 100);
  totalRecCts  = totalRecCts % 100;
  totalPayRs  += Math.floor(totalPayCts / 100);
  totalPayCts  = totalPayCts % 100;

  setCell('total-receipts-rs',  fmt(totalRecRs));
  setCell('total-receipts-cts', fmtCts(totalRecCts));
  setCell('total-payments-rs',  fmt(totalPayRs));
  setCell('total-payments-cts', fmtCts(totalPayCts));
}

/* ════════════════════════════════════════════════
   Render — Summary table
   ════════════════════════════════════════════════ */
function renderSummaryTable(grandTotal) {
  const bbfRaw  = grandTotal ? grandTotal.tlbf01 : 0;
  const recRaw  = grandTotal ? grandTotal.tlbf02 : 0;
  const payRaw  = grandTotal ? grandTotal.tlbf16 : 0;

  const bbfRs   = Math.floor(bbfRaw / 100),  bbfCts  = bbfRaw  % 100;
  const recRs   = Math.floor(recRaw / 100),  recCts  = recRaw  % 100;
  const payRs   = Math.floor(payRaw / 100),  payCts  = payRaw  % 100;

  const subRaw   = bbfRaw + recRaw;
  const subRs    = Math.floor(subRaw / 100), subCts  = subRaw  % 100;

  const balRaw   = subRaw - payRaw;
  const balRs    = Math.floor(Math.abs(balRaw) / 100) * Math.sign(balRaw);
  const balCts   = Math.abs(balRaw) % 100;

  setCell('s-bbf-rs',       fmt(bbfRs));
  setCell('s-bbf-cts',      fmtCts(bbfCts));
  setCell('s-receipts-rs',  fmt(recRs));
  setCell('s-receipts-cts', fmtCts(recCts));
  setCell('s-subtotal-rs',  fmt(subRs));
  setCell('s-subtotal-cts', fmtCts(subCts));
  setCell('s-payments-rs',  fmt(payRs));
  setCell('s-payments-cts', fmtCts(payCts));
  setCell('s-balance-rs',   fmt(balRs));
  setCell('s-balance-cts',  fmtCts(balCts));
}

/* ════════════════════════════════════════════════
   Calculate button
   ════════════════════════════════════════════════ */
btnCalculate.addEventListener('click', () => {
  console.log('Calculate clicked.');
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

/** Format a large raw integer with comma-thousands */
function fmtBig(n) {
  if (n === 0) return '0';
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
