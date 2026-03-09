/* ═══════════════════════════════════════════════
   Cash Balance Checker — app.js
   ═══════════════════════════════════════════════ */

'use strict';

/* ── Helpers ── */
const padTellerId = id => String(id).padStart(7, '0');
const branchCode  = tellerId => tellerId.substring(0, 3);

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

/* ── Raw cashier data from file 1 (paise) for tally ── */
let currentCashierRawMap = {};  // { tellerId: { depositsRaw, withdrawalsRaw } }

/* ── Second file state ── */
let currentFile2Balances = {};  // { tellerId: { cashInRaw, cashOutRaw } }

/* ── Adjustment state (in paise/cents, reset on new file) ── */
let receiptsAdjRaw = 0;
let paymentsAdjRaw = 0;
let tellerAdjMap   = {};   // { [tellerKey]: { receipts: 0, payments: 0 } }

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

  // Reveal second-file section; reset its state for the new file
  document.getElementById('second-doc-section').hidden = false;
  document.getElementById('second-upload-wrap').hidden = false;
  document.getElementById('teller-panel').hidden = true;
  currentFile2Balances = {};
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
        teller:   padTellerId(parts[2]),
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
        teller:   padTellerId(parts[1]),
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

  // Store raw paise values for later tally comparison with file 2
  currentCashierRawMap = {};
  Object.entries(cashierMap).forEach(([key, data]) => {
    currentCashierRawMap[key] = {
      depositsRaw:    data.deposits,
      withdrawalsRaw: data.withdrawals,
    };
  });

  const cashiers = Object.values(cashierMap).map(r => {
    const adj    = tellerAdjMap[r.name] || { receipts: 0, payments: 0 };
    const totDep = r.deposits    + adj.receipts;
    const totWit = r.withdrawals + adj.payments;
    return {
      name:        r.name,
      receiptsRs:  Math.floor(Math.abs(totDep) / 100) * (totDep < 0 ? -1 : 1),
      receiptsCts: Math.abs(totDep) % 100,
      paymentsRs:  Math.floor(Math.abs(totWit) / 100) * (totWit < 0 ? -1 : 1),
      paymentsCts: Math.abs(totWit) % 100,
      receiptsAdj: adj.receipts,
      paymentsAdj: adj.payments,
    };
  });

  const count = cashiers.length;
  rowCountEl.textContent = `${count} cashier${count !== 1 ? 's' : ''}`;

  // Pad to at least 9 rows for a full-looking form
  while (cashiers.length < 9) {
    cashiers.push({ name: '', receiptsRs: 0, receiptsCts: 0, paymentsRs: 0, paymentsCts: 0, receiptsAdj: 0, paymentsAdj: 0 });
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
  let currentBranch = null;

  rows.forEach((row) => {
    // Insert branch header when branch changes (skip for empty padding rows)
    if (row.name && row.name.length >= 3) {
      const branch = branchCode(row.name);
      if (branch !== currentBranch) {
        currentBranch = branch;
        const hdr = document.createElement('tr');
        hdr.className = 'branch-header-row';
        hdr.innerHTML = `<td colspan="5">Branch ${escHtml(branch)}</td>`;
        cashierTbody.appendChild(hdr);
      }
    }

    const tr = document.createElement('tr');
    if (!row.name) tr.classList.add('empty-row');

    const recAdj = row.name ? ` data-adjkey="${escHtml(row.name)}" data-adjcol="receipts" title="Right-click to adjust"` : '';
    const payAdj = row.name ? ` data-adjkey="${escHtml(row.name)}" data-adjcol="payments" title="Right-click to adjust"` : '';
    const adjDot = (row.receiptsAdj || row.paymentsAdj) ? '<span class="teller-adj-dot">&#x25CF;</span>' : '';

    tr.innerHTML = `
      <td>${escHtml(row.name)}${adjDot}</td>
      <td class="num receipts-rs"${recAdj}>${fmt(row.receiptsRs)}</td>
      <td class="num cts receipts-cts">${fmtCts(row.receiptsCts)}</td>
      <td class="num payments-rs"${payAdj}>${fmt(row.paymentsRs)}</td>
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
  // Reset all adjustments and BBF on each new file load
  receiptsAdjRaw = 0;
  paymentsAdjRaw = 0;
  tellerAdjMap   = {};
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
   Works for both the summary table rows and
   individual teller/unit rows in the cashier table.
   ════════════════════════════════════════════════ */
(function () {
  const menu      = document.getElementById('adj-menu');
  const menuTitle = document.getElementById('adj-menu-title');
  const btnPlus   = document.getElementById('adj-btn-plus');
  const btnMinus  = document.getElementById('adj-btn-minus');
  const rsInput   = document.getElementById('adj-rs');
  const ctsInput  = document.getElementById('adj-cts');
  const applyBtn  = document.getElementById('adj-apply');
  const cancelBtn = document.getElementById('adj-cancel');
  const closeBtn  = document.getElementById('adj-close');

  let adjTarget  = null;  // 'receipts' | 'payments'
  let adjSign    = 1;     // +1 | -1
  let adjContext = null;  // 'summary' | 'teller'
  let adjKey     = null;  // teller/unit key when context === 'teller'

  function openMenu(target, context, key, clientX, clientY) {
    adjTarget  = target;
    adjContext = context;
    adjKey     = key;
    adjSign    = 1;
    menuTitle.textContent = target === 'receipts' ? 'Adjust Receipts' : 'Adjust Payments';
    btnPlus.classList.add('active');
    btnMinus.classList.remove('active');
    rsInput.value  = '';
    ctsInput.value = '';

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

  // ── Summary table rows ──
  document.getElementById('s-receipts-row').addEventListener('contextmenu', (e) => {
    e.preventDefault();
    openMenu('receipts', 'summary', null, e.clientX, e.clientY);
  });
  document.getElementById('s-payments-row').addEventListener('contextmenu', (e) => {
    e.preventDefault();
    openMenu('payments', 'summary', null, e.clientX, e.clientY);
  });

  // ── Cashier table — event delegation on cells with data-adjkey ──
  cashierTbody.addEventListener('contextmenu', (e) => {
    const cell = e.target.closest('[data-adjkey]');
    if (!cell) return;
    e.preventDefault();
    openMenu(cell.dataset.adjcol, 'teller', cell.dataset.adjkey, e.clientX, e.clientY);
  });

  // ── Sign toggle ──
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

  // ── Apply ──
  applyBtn.addEventListener('click', () => {
    const rs    = parseInt(rsInput.value,  10) || 0;
    const cts   = Math.min(99, parseInt(ctsInput.value, 10) || 0);
    const delta = adjSign * (rs * 100 + cts);

    if (adjContext === 'summary') {
      if (adjTarget === 'receipts') receiptsAdjRaw += delta;
      else                          paymentsAdjRaw += delta;
      closeMenu();
      updateSummaryFromCashierTotals();
    } else if (adjContext === 'teller') {
      if (!tellerAdjMap[adjKey]) tellerAdjMap[adjKey] = { receipts: 0, payments: 0 };
      tellerAdjMap[adjKey][adjTarget] += delta;
      closeMenu();
      buildAndRenderCashierTable(currentRecords);
      updateSummaryFromCashierTotals();
    }
  });

  // Enter key confirms
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

/* ════════════════════════════════════════════════
   Second file — upload handler
   ════════════════════════════════════════════════ */
document.getElementById('file-input-2').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload  = (ev) => handleSecondFileLoaded(file.name, ev.target.result);
  reader.onerror = () => alert('Error reading file. Please try again.');
  reader.readAsText(file);
});

function handleSecondFileLoaded(fileName, rawText) {
  const lines = rawText
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);

  const transactions = parseSecondFile(lines);
  const balances     = buildTellerBalances(transactions);
  currentFile2Balances = balances;

  document.getElementById('file2-name').textContent = fileName;
  document.getElementById('second-upload-wrap').hidden = true;
  document.getElementById('teller-panel').hidden = false;

  renderTellerBalanceTable(balances);
  renderTallyTable(balances);
}

/* ════════════════════════════════════════════════
   Parser — second file
   Format (no header row when submitted):
     [0] controlUnit   e.g. B5
     [1] cashIn        teller id that received cash
     [2] cashOut       teller id that gave out cash
     [3] code          transaction code
     [4] ref           reference
     [5] amount        in paise
   ════════════════════════════════════════════════ */
function parseSecondFile(lines) {
  const transactions = [];
  lines.forEach(line => {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 6) return;

    // Skip any header row (amount column would not be a number)
    const amount = parseInt(parts[5], 10);
    if (isNaN(amount)) return;

    transactions.push({
      controlUnit: parts[0],
      cashIn:      padTellerId(parts[1]),
      cashOut:     padTellerId(parts[2]),
      code:        parts[3],
      ref:         parts[4],
      amount,
    });
  });
  return transactions;
}

/* ════════════════════════════════════════════════
   Build teller balances from second file
   Logic: start each teller at 0
     • cashIn  teller → balance += amount
     • cashOut teller → balance -= amount
   ════════════════════════════════════════════════ */
function buildTellerBalances(transactions) {
  const balances = {};

  function init(id) {
    if (!balances[id]) balances[id] = { cashInTotal: 0, cashOutTotal: 0, balance: 0 };
  }

  transactions.forEach(t => {
    init(t.cashIn);
    init(t.cashOut);

    // cashIn teller receives money — balance goes UP
    balances[t.cashIn].cashInTotal += t.amount;
    balances[t.cashIn].balance     += t.amount;

    // cashOut teller gives money — balance goes DOWN
    balances[t.cashOut].cashOutTotal += t.amount;
    balances[t.cashOut].balance      -= t.amount;
  });

  return balances;
}

/* ════════════════════════════════════════════════
   Render — Teller-wise Balance table (file 2)
   ════════════════════════════════════════════════ */
function renderTellerBalanceTable(balances) {
  const tbody = document.getElementById('teller-tbody');
  tbody.innerHTML = '';

  let totInRaw = 0, totOutRaw = 0, totBalRaw = 0;
  let currentBranch = null;

  const sorted = Object.entries(balances).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));

  sorted.forEach(([teller, data]) => {
    // Insert branch header when branch changes
    const branch = branchCode(teller);
    if (branch !== currentBranch) {
      currentBranch = branch;
      const hdr = document.createElement('tr');
      hdr.className = 'branch-header-row';
      hdr.innerHTML = `<td colspan="7">Branch ${escHtml(branch)}</td>`;
      tbody.appendChild(hdr);
    }

    totInRaw  += data.cashInTotal;
    totOutRaw += data.cashOutTotal;
    totBalRaw += data.balance;

    const inSp  = splitPaise(data.cashInTotal);
    const outSp = splitPaise(data.cashOutTotal);
    const balSp = splitPaise(data.balance);
    const neg   = data.balance < 0;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="teller-id-cell">${escHtml(teller)}</td>
      <td class="num receipts-rs">${fmt(inSp.rs)}</td>
      <td class="num cts receipts-cts">${fmtCts(inSp.cts)}</td>
      <td class="num payments-rs">${fmt(outSp.rs)}</td>
      <td class="num cts payments-cts">${fmtCts(outSp.cts)}</td>
      <td class="num net-cell ${neg ? 'neg-balance' : ''}">${neg ? '−' : ''}${fmt(Math.abs(balSp.rs))}</td>
      <td class="num cts net-cts ${neg ? 'neg-balance' : ''}">${fmtCts(balSp.cts)}</td>
    `;
    tbody.appendChild(tr);
  });

  const tInSp  = splitPaise(totInRaw);
  const tOutSp = splitPaise(totOutRaw);
  const tBalSp = splitPaise(totBalRaw);
  const tNeg   = totBalRaw < 0;

  setCell('t-total-in-rs',   fmt(tInSp.rs));
  setCell('t-total-in-cts',  fmtCts(tInSp.cts));
  setCell('t-total-out-rs',  fmt(tOutSp.rs));
  setCell('t-total-out-cts', fmtCts(tOutSp.cts));
  setCell('t-total-net-rs',  (tNeg ? '−' : '') + fmt(Math.abs(tBalSp.rs)));
  setCell('t-total-net-cts', fmtCts(tBalSp.cts));

  const count = sorted.length;
  document.getElementById('teller-count').textContent = `${count} teller${count !== 1 ? 's' : ''}`;
}

/* ════════════════════════════════════════════════
   Render — Tally table (file 1 vs file 2)
   ════════════════════════════════════════════════ */
function renderTallyTable(file2Balances) {
  const tbody = document.getElementById('tally-tbody');
  tbody.innerHTML = '';

  // All unique teller IDs from both files
  const allTellers = [...new Set([
    ...Object.keys(currentCashierRawMap),
    ...Object.keys(file2Balances),
  ])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  let matchCount = 0, diffCount = 0, missingCount = 0;
  let currentBranch = null;

  allTellers.forEach(teller => {
    // Insert branch header when branch changes
    const branch = branchCode(teller);
    if (branch !== currentBranch) {
      currentBranch = branch;
      const hdr = document.createElement('tr');
      hdr.className = 'branch-header-row';
      hdr.innerHTML = `<td colspan="8">Branch ${escHtml(branch)}</td>`;
      tbody.appendChild(hdr);
    }

    const f1 = currentCashierRawMap[teller];
    const f2 = file2Balances[teller];

    const f1NetRaw = f1 ? (f1.depositsRaw - f1.withdrawalsRaw) : null;
    const f2NetRaw = f2 ? f2.balance : null;

    let sumRaw  = null;
    let matched = false;

    if (f1NetRaw !== null && f2NetRaw !== null) {
      // Both sides must cancel — if their sum is 0 the account is balanced
      sumRaw  = f1NetRaw + f2NetRaw;
      matched = sumRaw === 0;
      matched ? matchCount++ : diffCount++;
    } else {
      missingCount++;
    }

    const cellF1  = f1NetRaw !== null ? pairCells(splitPaise(f1NetRaw)) : naCell(2);
    const cellF2  = f2NetRaw !== null ? pairCells(splitPaise(f2NetRaw)) : naCell(2);
    const cellDif = sumRaw   !== null ? pairCells(splitPaise(sumRaw))   : naCell(2);

    let statusHtml;
    if (f1NetRaw !== null && f2NetRaw !== null) {
      statusHtml = matched
        ? '<span class="tally-badge tally-match">&#10003; Match</span>'
        : '<span class="tally-badge tally-diff">&#10007; Differs</span>';
    } else {
      statusHtml = '<span class="tally-badge tally-missing">&#9888; Missing</span>';
    }

    const tr = document.createElement('tr');
    tr.className = f1NetRaw !== null && f2NetRaw !== null
      ? (matched ? 'tally-row-match' : 'tally-row-diff')
      : 'tally-row-missing';

    tr.innerHTML = `
      <td class="teller-id-cell">${escHtml(teller)}</td>
      ${cellF1}${cellF2}${cellDif}
      <td class="status-cell">${statusHtml}</td>
    `;
    tbody.appendChild(tr);
  });

  // Summary footer
  const total = allTellers.length;
  const summaryLabel = `${total} teller${total !== 1 ? 's' : ''}`;
  const summaryMsg   = [
    matchCount   ? `<span class="tally-badge tally-match">${matchCount} matched</span>`   : '',
    diffCount    ? `<span class="tally-badge tally-diff">${diffCount} differ${diffCount !== 1 ? 's' : ''}</span>`    : '',
    missingCount ? `<span class="tally-badge tally-missing">${missingCount} missing</span>` : '',
  ].filter(Boolean).join(' ');

  setCell('tally-summary-label', summaryLabel);
  const msgEl = document.getElementById('tally-summary-msg');
  if (msgEl) msgEl.innerHTML = summaryMsg;
}

/* ── Helper: build two <td> cells from a splitPaise result ── */
function pairCells(sp) {
  const neg   = sp.rs < 0 || (sp.rs === 0 && sp.neg);
  const sign  = neg ? '−' : '';
  return `<td class="num ${neg ? 'neg-balance' : ''}">${sign}${fmt(Math.abs(sp.rs))}</td>`
       + `<td class="num cts ${neg ? 'neg-balance' : ''}">${fmtCts(sp.cts)}</td>`;
}

/* ── Helper: N colspan "—" cells ── */
function naCell(span) {
  return `<td class="num na-cell" colspan="${span}">—</td>`;
}

/* ════════════════════════════════════════════════
   Utility — split a paise integer into Rs / Cts
   ════════════════════════════════════════════════ */
function splitPaise(raw) {
  const neg = raw < 0;
  const abs = Math.abs(raw);
  return {
    rs:  Math.floor(abs / 100) * (neg ? -1 : 1),
    cts: abs % 100,
    neg,
  };
}
