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

  // Aggregate detail rows (type=2) by teller number
  const tellerMap = {};
  records
    .filter(r => r.type === 2)
    .forEach(r => {
      if (!tellerMap[r.teller]) {
        tellerMap[r.teller] = { teller: r.teller, tlbf02: 0, tlbf16: 0 };
      }
      tellerMap[r.teller].tlbf02 += r.tlbf02;
      tellerMap[r.teller].tlbf16 += r.tlbf16;
    });

  // Build cashier rows from aggregated teller data
  const cashiers = Object.values(tellerMap).map(r => ({
    name:        r.teller,
    receiptsRs:  Math.floor(r.tlbf02 / 100),
    receiptsCts: r.tlbf02 % 100,
    paymentsRs:  Math.floor(r.tlbf16 / 100),
    paymentsCts: r.tlbf16 % 100,
  }));

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
   Detail / subtotal rows (8 parts):
     [0] type        — 2=detail, 1=control-unit subtotal
     [1] unit        — control unit (e.g. B5, J5)
     [2] teller      — teller number (0 for subtotals)
     [3] currency    — 100 / 200 / 105 / 0
     [4] tlbf01
     [5] tlbf02
     [6] tlbf15
     [7] tlbf16

   Grand-total row (7 parts, type=0, no unit column):
     [0] type=0
     [1] teller=0
     [2] currency=0
     [3..6] tlbf01..tlbf16
   ════════════════════════════════════════════════ */
function parseTextFile(lines) {
  const records = [];
  let grandTotal = null;

  lines.forEach(line => {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 7) return;

    let record;

    if (parts.length >= 8) {
      // Detail or control-unit subtotal row — has unit column
      record = {
        type:     parseInt(parts[0], 10),
        unit:     parts[1],
        teller:   parts[2],
        currency: parts[3],
        tlbf01:   parseInt(parts[4], 10) || 0,
        tlbf02:   parseInt(parts[5], 10) || 0,
        tlbf15:   parseInt(parts[6], 10) || 0,
        tlbf16:   parseInt(parts[7], 10) || 0,
      };
    } else {
      // Grand-total row (type=0) — no unit column
      record = {
        type:     parseInt(parts[0], 10),
        unit:     '',
        teller:   parts[1],
        currency: parts[2],
        tlbf01:   parseInt(parts[3], 10) || 0,
        tlbf02:   parseInt(parts[4], 10) || 0,
        tlbf15:   parseInt(parts[5], 10) || 0,
        tlbf16:   parseInt(parts[6], 10) || 0,
      };
    }

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

  records.filter(rec => rec.teller !== '0').forEach(rec => {
    const tr = document.createElement('tr');

    // Row style based on type (used internally, not displayed as a column)
    if (rec.type === 0) {
      tr.classList.add('raw-grand-total');
    } else if (rec.type === 1) {
      tr.classList.add('raw-subtotal');
    }

    tr.innerHTML = `
      <td class="col-unit-cell">${escHtml(rec.unit)}</td>
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
