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

/* ── Unit type state: { 'B5': 'branch' | 'service-center', … } ── */
let unitTypes    = {};
let currentRecords = [];

/* ── Adjustment state (in paise/cents, reset on new file) ── */
let receiptsAdjRaw = 0;
let paymentsAdjRaw = 0;

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

  // Save records globally so unit-config changes can re-render the table
  currentRecords = records;

  // Detect unique control units (preserve file order)
  const units = [...new Set(
    records.filter(r => r.unit && r.unit !== '').map(r => r.unit)
  )];

  // Reset unit types for the new file (keep previous selections if unit still exists)
  const prevTypes = unitTypes;
  unitTypes = {};
  units.forEach(u => { unitTypes[u] = prevTypes[u] || 'branch'; });

  renderUnitConfig(units);
  renderRawTable(records);
  buildAndRenderCashierTable(records);
  renderSummaryTable();   // reads totals from cashier table, not the file grand-total row

  // Show report, hide upload prompt
  uploadPrompt.hidden = true;
  reportPanel.hidden  = false;
  btnCalculate.disabled = false;
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
   Render — Unit Configuration panel
   ════════════════════════════════════════════════ */
function renderUnitConfig(units) {
  const body = document.getElementById('unit-config-body');
  body.innerHTML = '';

  units.forEach(unit => {
    const row = document.createElement('div');
    row.className = 'unit-config-row';
    row.innerHTML = `
      <span class="unit-code">${escHtml(unit)}</span>
      <div class="unit-toggle-group">
        <button class="unit-toggle-btn ${unitTypes[unit] === 'branch' ? 'active' : ''}"
                data-unit="${escHtml(unit)}" data-type="branch">Branch</button>
        <button class="unit-toggle-btn ${unitTypes[unit] === 'service-center' ? 'active' : ''}"
                data-unit="${escHtml(unit)}" data-type="service-center">Service Center</button>
      </div>
    `;
    body.appendChild(row);
  });

  // Toggle click handler
  body.addEventListener('click', (e) => {
    const btn = e.target.closest('.unit-toggle-btn');
    if (!btn) return;

    const unit = btn.dataset.unit;
    const type = btn.dataset.type;
    unitTypes[unit] = type;

    // Update active state for this unit's buttons
    body.querySelectorAll(`.unit-toggle-btn[data-unit="${unit}"]`).forEach(b => {
      b.classList.toggle('active', b.dataset.type === type);
    });

    // Re-render raw table (badge) and cashier table (grouping),
    // then push the new totals into the summary table
    renderRawTable(currentRecords);
    buildAndRenderCashierTable(currentRecords);
    updateSummaryFromCashierTotals();
  });
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

    const uType  = unitTypes[rec.unit];
    const badge  = uType
      ? `<span class="unit-type-badge ${uType}">${uType === 'branch' ? 'Branch' : 'Svc. Center'}</span>`
      : '';

    tr.innerHTML = `
      <td class="col-unit-cell">${escHtml(rec.unit)}${badge}</td>
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
   Build + Render — Cashier table
   ════════════════════════════════════════════════
   Branch units     → one row per individual teller
   Service Center   → one aggregated row per unit,
                      named after the unit code
   ════════════════════════════════════════════════ */
function buildAndRenderCashierTable(records) {
  // Ordered map: key = display name (teller id OR unit code)
  const cashierMap = {};

  records
    .filter(r => r.type === 2)
    .forEach(r => {
      // Service-center units collapse all their tellers into one row
      const key = unitTypes[r.unit] === 'service-center' ? r.unit : r.teller;

      if (!cashierMap[key]) {
        cashierMap[key] = { name: key, deposits: 0, withdrawals: 0 };
      }

      if (r.currency === '100' || r.currency === '105') {
        cashierMap[key].deposits += r.tlbf02;
      }
      if (r.currency === '200') {
        cashierMap[key].withdrawals += r.tlbf16;
      }
    });

  const cashiers = Object.values(cashierMap).map(r => ({
    name:        r.name,
    receiptsRs:  Math.floor(r.deposits / 100),
    receiptsCts: r.deposits % 100,
    paymentsRs:  Math.floor(r.withdrawals / 100),
    paymentsCts: r.withdrawals % 100,
  }));

  const count = cashiers.length;
  rowCountEl.textContent = `${count} cashier${count !== 1 ? 's' : ''}`;

  // Pad to at least 9 rows for a full-looking form
  while (cashiers.length < 9) {
    cashiers.push({ name: '', receiptsRs: 0, receiptsCts: 0, paymentsRs: 0, paymentsCts: 0 });
  }

  renderCashierTable(cashiers);
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
   Sync Summary receipts/payments from cashier totals
   Called after cashier table is rebuilt, and also
   whenever unit types are toggled.
   ════════════════════════════════════════════════ */
function updateSummaryFromCashierTotals() {
  // Read base totals from cashier footer
  const baseRecRs  = parseInt((document.getElementById('total-receipts-rs').textContent  || '0').replace(/,/g, ''), 10) || 0;
  const baseRecCts = parseInt( document.getElementById('total-receipts-cts').textContent || '0', 10) || 0;
  const basePayRs  = parseInt((document.getElementById('total-payments-rs').textContent  || '0').replace(/,/g, ''), 10) || 0;
  const basePayCts = parseInt( document.getElementById('total-payments-cts').textContent || '0', 10) || 0;

  // Apply cumulative adjustments
  const adjRecRaw = baseRecRs * 100 + baseRecCts + receiptsAdjRaw;
  const adjPayRaw = basePayRs * 100 + basePayCts + paymentsAdjRaw;

  const adjRecRs  = Math.floor(Math.abs(adjRecRaw) / 100) * (adjRecRaw < 0 ? -1 : 1);
  const adjRecCts = Math.abs(adjRecRaw) % 100;
  const adjPayRs  = Math.floor(Math.abs(adjPayRaw) / 100) * (adjPayRaw < 0 ? -1 : 1);
  const adjPayCts = Math.abs(adjPayRaw) % 100;

  setCell('s-receipts-rs',  fmt(adjRecRs));
  setCell('s-receipts-cts', fmtCts(adjRecCts));
  setCell('s-payments-rs',  fmt(adjPayRs));
  setCell('s-payments-cts', fmtCts(adjPayCts));

  // Update adjustment badges
  updateAdjBadge('s-receipts-adj-badge', receiptsAdjRaw);
  updateAdjBadge('s-payments-adj-badge', paymentsAdjRaw);

  recalcSummary();
}

function updateAdjBadge(id, adjRaw) {
  const el = document.getElementById(id);
  if (!el) return;
  if (adjRaw === 0) { el.textContent = ''; el.className = 'adj-badge'; return; }
  const sign = adjRaw > 0 ? '+' : '\u2212';
  const abs  = Math.abs(adjRaw);
  el.textContent = `${sign}${fmt(Math.floor(abs / 100))}.${fmtCts(abs % 100)}`;
  el.className   = `adj-badge ${adjRaw > 0 ? 'positive' : 'negative'}`;
}

/* ════════════════════════════════════════════════
   Render — Summary table (called on new file load)
   Resets BBF to 0 then syncs from cashier totals.
   ════════════════════════════════════════════════ */
function renderSummaryTable() {
  // Reset adjustments and BBF on each new file load
  receiptsAdjRaw = 0;
  paymentsAdjRaw = 0;
  document.getElementById('s-bbf-rs').value  = 0;
  document.getElementById('s-bbf-cts').value = 0;
  updateSummaryFromCashierTotals();
}

/* ════════════════════════════════════════════════
   Recalculate Sub-Total and Balance from BBF inputs
   ════════════════════════════════════════════════ */
function recalcSummary() {
  const bbfRs  = parseInt(document.getElementById('s-bbf-rs').value,  10) || 0;
  const bbfCts = parseInt(document.getElementById('s-bbf-cts').value, 10) || 0;

  // Read receipts and payments from their display cells
  const recRs  = parseInt((document.getElementById('s-receipts-rs').textContent  || '0').replace(/,/g, ''), 10) || 0;
  const recCts = parseInt( document.getElementById('s-receipts-cts').textContent || '0', 10) || 0;
  const payRs  = parseInt((document.getElementById('s-payments-rs').textContent  || '0').replace(/,/g, ''), 10) || 0;
  const payCts = parseInt( document.getElementById('s-payments-cts').textContent || '0', 10) || 0;

  const bbfRaw = bbfRs  * 100 + bbfCts;
  const recRaw = recRs  * 100 + recCts;
  const payRaw = payRs  * 100 + payCts;

  const subRaw = bbfRaw + recRaw;
  const subRs  = Math.floor(subRaw / 100);
  const subCts = subRaw % 100;

  const balRaw = subRaw - payRaw;
  const balRs  = Math.floor(Math.abs(balRaw) / 100) * (balRaw < 0 ? -1 : 1);
  const balCts = Math.abs(balRaw) % 100;

  setCell('s-subtotal-rs',  fmt(subRs));
  setCell('s-subtotal-cts', fmtCts(subCts));
  setCell('s-balance-rs',   fmt(balRs));
  setCell('s-balance-cts',  fmtCts(balCts));
}

/* ── Wire BBF inputs to live-recalc ── */
document.getElementById('s-bbf-rs').addEventListener('input',  recalcSummary);
document.getElementById('s-bbf-cts').addEventListener('input', recalcSummary);

/* ════════════════════════════════════════════════
   Adjustment right-click context menu
   ════════════════════════════════════════════════ */
(function () {
  const menu       = document.getElementById('adj-menu');
  const menuTitle  = document.getElementById('adj-menu-title');
  const btnPlus    = document.getElementById('adj-btn-plus');
  const btnMinus   = document.getElementById('adj-btn-minus');
  const rsInput    = document.getElementById('adj-rs');
  const ctsInput   = document.getElementById('adj-cts');
  const applyBtn   = document.getElementById('adj-apply');
  const cancelBtn  = document.getElementById('adj-cancel');
  const closeBtn   = document.getElementById('adj-close');

  let adjTarget = null;  // 'receipts' | 'payments'
  let adjSign   = 1;     // +1 | -1

  function openMenu(target, clientX, clientY) {
    adjTarget = target;
    adjSign   = 1;
    menuTitle.textContent = target === 'receipts' ? 'Adjust Receipts' : 'Adjust Payments';
    btnPlus.classList.add('active');
    btnMinus.classList.remove('active');
    rsInput.value  = '';
    ctsInput.value = '';

    // Show first so we can measure dimensions
    menu.hidden = false;
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    let x = clientX + 6, y = clientY + 6;
    if (x + mw > window.innerWidth  - 8) x = clientX - mw - 6;
    if (y + mh > window.innerHeight - 8) y = clientY - mh - 6;
    menu.style.left = x + 'px';
    menu.style.top  = y + 'px';
    rsInput.focus();
  }

  function closeMenu() { menu.hidden = true; }

  // Right-click on Receipts row
  document.getElementById('s-receipts-row').addEventListener('contextmenu', (e) => {
    e.preventDefault();
    openMenu('receipts', e.clientX, e.clientY);
  });

  // Right-click on Payments row
  document.getElementById('s-payments-row').addEventListener('contextmenu', (e) => {
    e.preventDefault();
    openMenu('payments', e.clientX, e.clientY);
  });

  // Sign toggle
  btnPlus.addEventListener('click', () => {
    adjSign = 1;
    btnPlus.classList.add('active');
    btnMinus.classList.remove('active');
  });
  btnMinus.addEventListener('click', () => {
    adjSign = -1;
    btnMinus.classList.add('active');
    btnPlus.classList.remove('active');
  });

  // Apply adjustment
  applyBtn.addEventListener('click', () => {
    const rs  = parseInt(rsInput.value,  10) || 0;
    const cts = Math.min(99, parseInt(ctsInput.value, 10) || 0);
    const delta = adjSign * (rs * 100 + cts);
    if (adjTarget === 'receipts') receiptsAdjRaw += delta;
    else                          paymentsAdjRaw += delta;
    closeMenu();
    updateSummaryFromCashierTotals();
  });

  // Allow Enter key to apply
  [rsInput, ctsInput].forEach(inp => {
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyBtn.click(); });
  });

  // Cancel / close
  cancelBtn.addEventListener('click', closeMenu);
  closeBtn.addEventListener('click',  closeMenu);

  // Click outside closes
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !menu.contains(e.target)) closeMenu();
  });

  // Escape closes
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
  });
}());

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
