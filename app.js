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

/* ── Balance file state (reset on new main file) ── */
let balanceRecords = [];
let balanceAdjMap  = {};   // { [7-digit-teller]: { depositsNet: 0, withdrawalsNet: 0 } }

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

  // Reset balance file whenever a new main file is loaded
  balanceRecords = [];
  balanceAdjMap  = {};
  document.getElementById('balance-data-wrap').hidden = true;
  document.getElementById('balance-file-name').textContent = '';

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
    .filter(r => r.teller !== '0')   // same set shown in the raw table — includes type 1 & 2
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
    const adj = tellerAdjMap[r.name] || { receipts: 0, payments: 0 };

    // Match balance-file adjustments using 7-digit normalised teller key
    const normKey = /^\d+$/.test(r.name) ? r.name.padStart(7, '0') : r.name;
    const balAdj  = balanceAdjMap[normKey] || { depositsNet: 0, withdrawalsNet: 0 };

    const totDep = r.deposits    + adj.receipts + balAdj.depositsNet;
    const totWit = r.withdrawals + adj.payments + balAdj.withdrawalsNet;
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
   Balance (Unbalanced Entries) file
   ════════════════════════════════════════════════
   File format (space-delimited, skip line 1):
     [0] type  [1] unit  [2] teller_id  [3] w/d
     [4] aa    [5] ab    [6] bb         [7] bc

   Rules applied per row:
     w/d = 100 → teller deposits   += bb − bc
     w/d = 200 → teller withdrawals += aa − ab

   Teller IDs are left-padded to 7 digits for matching.
   ════════════════════════════════════════════════ */
document.getElementById('balance-file-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload  = (ev) => handleBalanceFileLoaded(file.name, ev.target.result);
  reader.onerror = () => alert('Error reading balance file. Please try again.');
  reader.readAsText(file);
});

function handleBalanceFileLoaded(fileName, rawText) {
  const lines = rawText
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .slice(1);  // skip header line

  balanceRecords = parseBalanceFile(lines);
  buildBalanceAdjMap(balanceRecords);
  renderBalanceTable(balanceRecords);

  document.getElementById('balance-file-name').textContent = fileName;
  document.getElementById('balance-data-wrap').hidden = balanceRecords.length === 0;

  // Rebuild cashier table with balance adjustments applied, then sync summary
  buildAndRenderCashierTable(currentRecords);
  updateSummaryFromCashierTotals();
}

function parseBalanceFile(lines) {
  const records = [];
  lines.forEach(line => {
    const parts = line.split(/\s+/);
    if (parts.length < 8) return;

    const rawTeller = parts[2];
    // Pad teller ID to 7 digits with leading zeros
    const teller = /^\d+$/.test(rawTeller) ? rawTeller.padStart(7, '0') : rawTeller;

    records.push({
      unit:   parts[1],
      teller: teller,
      wd:     parts[3],          // '100' or '200'
      aa:     parseInt(parts[4], 10) || 0,
      ab:     parseInt(parts[5], 10) || 0,
      bb:     parseInt(parts[6], 10) || 0,
      bc:     parseInt(parts[7], 10) || 0,
    });
  });
  return records;
}

function buildBalanceAdjMap(records) {
  balanceAdjMap = {};
  records.forEach(r => {
    if (!balanceAdjMap[r.teller]) {
      balanceAdjMap[r.teller] = { depositsNet: 0, withdrawalsNet: 0 };
    }
    if (r.wd === '100') {
      balanceAdjMap[r.teller].depositsNet    += r.bb - r.bc;
    } else if (r.wd === '200') {
      balanceAdjMap[r.teller].withdrawalsNet += r.aa - r.ab;
    }
  });
}

function renderBalanceTable(records) {
  const tbody = document.getElementById('balance-tbody');
  tbody.innerHTML = '';

  records.forEach(r => {
    let net = 0, netLabel = '', netClass = 'bal-net-zero';

    if (r.wd === '100') {
      net      = r.bb - r.bc;
      netLabel = `Dep ${net >= 0 ? '+' : '\u2212'}${fmt(Math.floor(Math.abs(net) / 100))}.${fmtCts(Math.abs(net) % 100)}`;
      netClass = net >= 0 ? 'bal-net-dep' : 'bal-net-pay';
    } else if (r.wd === '200') {
      net      = r.aa - r.ab;
      netLabel = `Pay ${net >= 0 ? '+' : '\u2212'}${fmt(Math.floor(Math.abs(net) / 100))}.${fmtCts(Math.abs(net) % 100)}`;
      netClass = net >= 0 ? 'bal-net-pay' : 'bal-net-dep';
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escHtml(r.unit)}</td>
      <td>${escHtml(r.teller)}</td>
      <td>${escHtml(r.wd)}</td>
      <td class="num">${fmtBig(r.aa)}</td>
      <td class="num">${fmtBig(r.ab)}</td>
      <td class="num">${fmtBig(r.bb)}</td>
      <td class="num">${fmtBig(r.bc)}</td>
      <td class="${netClass}">${escHtml(netLabel)}</td>
    `;
    tbody.appendChild(tr);
  });
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

/* ════════════════════════════════════════════════
   Navigation Tabs — Main / V2
   ════════════════════════════════════════════════ */
(function () {
  const mainView   = document.querySelector('.app-main');
  const v2View     = document.getElementById('v2-view');
  const tabMain    = document.getElementById('tab-main');
  const tabV2      = document.getElementById('tab-v2');

  function switchView(view) {
    if (view === 'v2') {
      mainView.hidden = true;
      v2View.hidden   = false;
      tabMain.classList.remove('active');
      tabV2.classList.add('active');
    } else {
      mainView.hidden = false;
      v2View.hidden   = true;
      tabMain.classList.add('active');
      tabV2.classList.remove('active');
    }
  }

  tabMain.addEventListener('click', () => switchView('main'));
  tabV2.addEventListener('click',   () => switchView('v2'));
})();

/* ════════════════════════════════════════════════
   V2 — State
   ════════════════════════════════════════════════ */
let v2RecordsA = [];   // Parsed rows from File A

/* ════════════════════════════════════════════════
   V2 — File A upload handler
   ════════════════════════════════════════════════ */
document.getElementById('v2-file-a-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload  = (ev) => handleV2FileA(file.name, ev.target.result);
  reader.onerror = () => alert('Error reading File A. Please try again.');
  reader.readAsText(file);
});

function handleV2FileA(fileName, rawText) {
  const lines = rawText
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);

  v2RecordsA = parseV2FileA(lines);

  // Show status bar
  const statusEl = document.getElementById('v2-file-a-status');
  document.getElementById('v2-file-a-name').textContent  = fileName;
  document.getElementById('v2-file-a-count').textContent =
    `${v2RecordsA.length} row${v2RecordsA.length !== 1 ? 's' : ''}`;
  statusEl.hidden = false;

  // Show data panel and render tables
  document.getElementById('v2-data-panel').hidden = false;
  renderV2DetailTable(v2RecordsA);
  renderV2SummaryTable(v2RecordsA);

  // Re-run reconciliation if File B is already loaded
  if (v2RecordsB.length > 0) {
    renderV2Reconciliation(v2RecordsA, v2RecordsB);
  }
}

/* ════════════════════════════════════════════════
   V2 — File B upload handler (placeholder)
   ════════════════════════════════════════════════ */
document.getElementById('v2-file-b-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload  = (ev) => handleV2FileB(file.name, ev.target.result);
  reader.onerror = () => alert('Error reading File B. Please try again.');
  reader.readAsText(file);
});

/* ════════════════════════════════════════════════
   V2 — State for File B
   ════════════════════════════════════════════════ */
let v2RecordsB = [];   // Parsed rows from File B

function handleV2FileB(fileName, rawText) {
  const lines = rawText
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);

  v2RecordsB = parseV2FileB(lines);

  // Show status bar
  document.getElementById('v2-file-b-name').textContent  = fileName;
  document.getElementById('v2-file-b-count').textContent =
    `${v2RecordsB.length} row${v2RecordsB.length !== 1 ? 's' : ''}`;
  document.getElementById('v2-file-b-status').hidden = false;

  // Show File B panel and render tables
  document.getElementById('v2-file-b-panel').hidden = false;
  renderV2FileBTable(v2RecordsB);
  renderV2FileBNetTable(v2RecordsB);

  // Reconciliation requires File A — render if File A is already loaded
  if (v2RecordsA.length > 0) {
    renderV2Reconciliation(v2RecordsA, v2RecordsB);
  }
}

/* ════════════════════════════════════════════════
   V2 — Parser for File B
   Format (no header row):
     [0] controlUnit    e.g. A1
     [1] teller1        pad to 7 digits — amount is ADDED to this teller
     [2] teller2        pad to 7 digits — amount is REDUCED from this teller
     [3] ref            e.g. 917
     [4] refCurrency    e.g. 90326LKR → ref=90326, currency=LKR
     [5] amount         last column — the total to add/reduce
   ════════════════════════════════════════════════ */
function parseV2FileB(lines) {
  const records = [];
  lines.forEach(line => {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 6) return;

    const controlUnit = parts[0];
    const teller1     = padTellerId(parts[1]);
    const teller2     = padTellerId(parts[2]);
    const ref         = parts[3];

    // Extract ref number and currency from combined field (e.g. "90326LKR")
    const combined = parts[4] || '';
    const comboMatch = combined.match(/^(\d*)([A-Z]+)$/);
    const refNum   = comboMatch ? comboMatch[1] : combined;
    const currency = comboMatch ? comboMatch[2] : '';

    // Last column is the amount
    const amount = parseFloat(parts[parts.length - 1]);
    if (isNaN(amount)) return;

    records.push({ controlUnit, teller1, teller2, ref, refNum, currency, amount });
  });
  return records;
}

/* ════════════════════════════════════════════════
   V2 — Parser for File A
   Format (no header row):
     [0] tellerID        e.g. 111717  → pad to 7 digits
     [1] wdCurrency      e.g. 200LKR  → wd=200, currency=LKR
                              100LKR  → wd=100, currency=LKR
     [2] count           integer
     [3] total           decimal amount
     [4] ref             integer / reference
   ════════════════════════════════════════════════ */
function parseV2FileA(lines) {
  const records = [];
  lines.forEach(line => {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4) return;

    const tellerRaw   = parts[0];
    const wdCurrency  = parts[1] || '';

    // Extract W/D code (first 3 chars must be digits) and currency (the rest)
    const wdMatch = wdCurrency.match(/^(\d+)([A-Z]+)$/);
    if (!wdMatch) return;   // skip malformed rows
    const wd       = wdMatch[1];   // '100' or '200' (or other codes)
    const currency = wdMatch[2];   // 'LKR', 'USD', etc.

    const count = parseInt(parts[2], 10);
    const total = parseFloat(parts[3]);
    const ref   = parts[4] !== undefined ? parts[4] : '';

    if (isNaN(count) || isNaN(total)) return;

    records.push({
      teller:   padTellerId(tellerRaw),
      wd,
      currency,
      count,
      total,     // decimal, e.g. 31406928.08
      ref,
    });
  });
  return records;
}

/* ════════════════════════════════════════════════
   V2 — Format a decimal amount with commas
   ════════════════════════════════════════════════ */
function fmtAmt(n) {
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ════════════════════════════════════════════════
   V2 — Render Detail table
   ════════════════════════════════════════════════ */
function renderV2DetailTable(records) {
  const tbody = document.getElementById('v2-detail-tbody');
  tbody.innerHTML = '';
  let currentBranch = null;

  records.forEach(r => {
    const branch = branchCode(r.teller);
    if (branch !== currentBranch) {
      currentBranch = branch;
      const hdr = document.createElement('tr');
      hdr.className = 'branch-header-row';
      hdr.innerHTML = `<td colspan="7">Branch ${escHtml(branch)}</td>`;
      tbody.appendChild(hdr);
    }

    const isDeposit    = r.wd === '100';
    const isWithdrawal = r.wd === '200';
    const typeLabel    = isDeposit    ? 'Deposit'
                       : isWithdrawal ? 'Withdrawal'
                       : r.wd;
    const typeClass    = isDeposit    ? 'wd-deposit'
                       : isWithdrawal ? 'wd-withdrawal'
                       : '';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="teller-id-cell">${escHtml(r.teller)}</td>
      <td class="num" style="text-align:center">${escHtml(r.wd)}</td>
      <td class="${typeClass}">${escHtml(typeLabel)}</td>
      <td style="text-align:center">${escHtml(r.currency)}</td>
      <td class="num">${fmt(r.count)}</td>
      <td class="num">${fmtAmt(r.total)}</td>
      <td class="num">${escHtml(r.ref)}</td>
    `;
    tbody.appendChild(tr);
  });
}

/* ════════════════════════════════════════════════
   V2 — Render Summary table (per teller + currency)
   Shows: deposits count/amount, withdrawals count/amount, difference
   ════════════════════════════════════════════════ */
function renderV2SummaryTable(records) {
  const tbody = document.getElementById('v2-summary-tbody');
  tbody.innerHTML = '';

  // Aggregate by teller + currency
  const map = {};
  records.forEach(r => {
    const key = r.teller + '|' + r.currency;
    if (!map[key]) {
      map[key] = {
        teller:   r.teller,
        currency: r.currency,
        depCount: 0,  depTotal: 0,
        wdCount:  0,  wdTotal:  0,
      };
    }
    if (r.wd === '100') {
      map[key].depCount += r.count;
      map[key].depTotal += r.total;
    } else if (r.wd === '200') {
      map[key].wdCount  += r.count;
      map[key].wdTotal  += r.total;
    }
  });

  const sorted = Object.values(map).sort((a, b) =>
    a.teller.localeCompare(b.teller, undefined, { numeric: true })
  );

  let totDepCount = 0, totDepTotal = 0;
  let totWdCount  = 0, totWdTotal  = 0;
  let currentBranch = null;

  sorted.forEach(row => {
    const branch = branchCode(row.teller);
    if (branch !== currentBranch) {
      currentBranch = branch;
      const hdr = document.createElement('tr');
      hdr.className = 'branch-header-row';
      hdr.innerHTML = `<td colspan="8">Branch ${escHtml(branch)}</td>`;
      tbody.appendChild(hdr);
    }

    const diffCount = row.depCount - row.wdCount;
    const diffTotal = row.depTotal - row.wdTotal;

    const diffClass = diffTotal > 0 ? 'diff-positive'
                    : diffTotal < 0 ? 'diff-negative'
                    : 'diff-zero';

    const sign = diffTotal < 0 ? '−' : (diffTotal > 0 ? '+' : '');

    totDepCount += row.depCount;
    totDepTotal += row.depTotal;
    totWdCount  += row.wdCount;
    totWdTotal  += row.wdTotal;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="teller-id-cell">${escHtml(row.teller)}</td>
      <td style="text-align:center">${escHtml(row.currency)}</td>
      <td class="num receipts-rs">${fmt(row.depCount)}</td>
      <td class="num receipts-rs">${fmtAmt(row.depTotal)}</td>
      <td class="num payments-rs">${fmt(row.wdCount)}</td>
      <td class="num payments-rs">${fmtAmt(row.wdTotal)}</td>
      <td class="num ${diffClass}">${fmt(Math.abs(diffCount))}</td>
      <td class="num ${diffClass}">${sign}${fmtAmt(Math.abs(diffTotal))}</td>
    `;
    tbody.appendChild(tr);
  });

  // Totals footer
  const totDiff      = totDepTotal - totWdTotal;
  const totDiffCount = totDepCount - totWdCount;
  const totClass     = totDiff > 0 ? 'diff-positive' : totDiff < 0 ? 'diff-negative' : 'diff-zero';
  const totSign      = totDiff < 0 ? '−' : (totDiff > 0 ? '+' : '');

  setCell('v2-tot-dep-count',  fmt(totDepCount));
  setCell('v2-tot-dep-amt',    fmtAmt(totDepTotal));
  setCell('v2-tot-wd-count',   fmt(totWdCount));
  setCell('v2-tot-wd-amt',     fmtAmt(totWdTotal));

  const diffCountEl = document.getElementById('v2-tot-diff-count');
  const diffAmtEl   = document.getElementById('v2-tot-diff-amt');
  if (diffCountEl) { diffCountEl.textContent = fmt(Math.abs(totDiffCount)); diffCountEl.className = `num col-net ${totClass}`; }
  if (diffAmtEl)   { diffAmtEl.textContent   = totSign + fmtAmt(Math.abs(totDiff)); diffAmtEl.className = `num col-net ${totClass}`; }
}

/* ════════════════════════════════════════════════
   V2 — Render File B raw entries table
   ════════════════════════════════════════════════ */
function renderV2FileBTable(records) {
  const tbody = document.getElementById('v2-fileb-tbody');
  tbody.innerHTML = '';

  let grandTotal = 0;

  records.forEach(r => {
    grandTotal += r.amount;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="text-align:center">${escHtml(r.controlUnit)}</td>
      <td class="teller-id-cell wd-deposit">${escHtml(r.teller1)}</td>
      <td class="teller-id-cell wd-withdrawal">${escHtml(r.teller2)}</td>
      <td class="num">${escHtml(r.ref)}</td>
      <td style="text-align:center">${escHtml(r.currency)}</td>
      <td class="num">${fmtAmt(r.amount)}</td>
    `;
    tbody.appendChild(tr);
  });

  setCell('v2-fileb-total', fmtAmt(grandTotal));
  document.getElementById('v2-file-b-row-count').textContent =
    `${records.length} row${records.length !== 1 ? 's' : ''}`;
}

/* ════════════════════════════════════════════════
   V2 — Build per-teller net from File B
   Returns { [teller7]: { added: n, reduced: n, net: n } }
   ════════════════════════════════════════════════ */
function buildV2FileBPerTellerNet(records) {
  const map = {};
  function init(id) {
    if (!map[id]) map[id] = { added: 0, reduced: 0, net: 0 };
  }
  records.forEach(r => {
    init(r.teller1);
    init(r.teller2);
    map[r.teller1].added   += r.amount;
    map[r.teller1].net     += r.amount;
    map[r.teller2].reduced += r.amount;
    map[r.teller2].net     -= r.amount;
  });
  return map;
}

/* ════════════════════════════════════════════════
   V2 — Render File B per-teller net table
   ════════════════════════════════════════════════ */
function renderV2FileBNetTable(records) {
  const tbody = document.getElementById('v2-fileb-net-tbody');
  tbody.innerHTML = '';

  const map = buildV2FileBPerTellerNet(records);
  const sorted = Object.entries(map).sort(([a], [b]) =>
    a.localeCompare(b, undefined, { numeric: true })
  );

  let totAdded = 0, totReduced = 0, totNet = 0;
  let currentBranch = null;

  sorted.forEach(([teller, data]) => {
    const branch = branchCode(teller);
    if (branch !== currentBranch) {
      currentBranch = branch;
      const hdr = document.createElement('tr');
      hdr.className = 'branch-header-row';
      hdr.innerHTML = `<td colspan="4">Branch ${escHtml(branch)}</td>`;
      tbody.appendChild(hdr);
    }

    totAdded   += data.added;
    totReduced += data.reduced;
    totNet     += data.net;

    const netClass = data.net > 0 ? 'diff-positive' : data.net < 0 ? 'diff-negative' : 'diff-zero';
    const netSign  = data.net < 0 ? '−' : '';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="teller-id-cell">${escHtml(teller)}</td>
      <td class="num receipts-rs">${fmtAmt(data.added)}</td>
      <td class="num payments-rs">${fmtAmt(data.reduced)}</td>
      <td class="num ${netClass}">${netSign}${fmtAmt(Math.abs(data.net))}</td>
    `;
    tbody.appendChild(tr);
  });

  const totNetClass = totNet > 0 ? 'diff-positive' : totNet < 0 ? 'diff-negative' : 'diff-zero';
  const totNetSign  = totNet < 0 ? '−' : '';

  setCell('v2-fileb-net-added',   fmtAmt(totAdded));
  setCell('v2-fileb-net-reduced', fmtAmt(totReduced));

  const netEl = document.getElementById('v2-fileb-net-total');
  if (netEl) {
    netEl.textContent = totNetSign + fmtAmt(Math.abs(totNet));
    netEl.className   = `num col-net ${totNetClass}`;
  }
}

/* ════════════════════════════════════════════════
   V2 — Build per-teller net from File A
   Returns { [teller7]: { depTotal: n, wdTotal: n, net: n } }
   ════════════════════════════════════════════════ */
function buildV2FileAPerTellerNet(records) {
  const map = {};
  records.forEach(r => {
    if (!map[r.teller]) map[r.teller] = { depTotal: 0, wdTotal: 0, net: 0 };
    if (r.wd === '100') {
      map[r.teller].depTotal += r.total;
      map[r.teller].net      += r.total;
    } else if (r.wd === '200') {
      map[r.teller].wdTotal  += r.total;
      map[r.teller].net      -= r.total;
    }
  });
  return map;
}

/* ════════════════════════════════════════════════
   V2 — Render Reconciliation table
   Per teller: File A net + File B net = 0?
   ════════════════════════════════════════════════ */
function renderV2Reconciliation(recordsA, recordsB) {
  const tbody = document.getElementById('v2-recon-tbody');
  tbody.innerHTML = '';

  const netA = buildV2FileAPerTellerNet(recordsA);
  const netB = buildV2FileBPerTellerNet(recordsB);

  const allTellers = [...new Set([...Object.keys(netA), ...Object.keys(netB)])].sort(
    (a, b) => a.localeCompare(b, undefined, { numeric: true })
  );

  let totA = 0, totB = 0, totDiff = 0;
  let balanced = 0, unbalanced = 0;
  let currentBranch = null;

  allTellers.forEach(teller => {
    const branch = branchCode(teller);
    if (branch !== currentBranch) {
      currentBranch = branch;
      const hdr = document.createElement('tr');
      hdr.className = 'branch-header-row';
      hdr.innerHTML = `<td colspan="5">Branch ${escHtml(branch)}</td>`;
      tbody.appendChild(hdr);
    }

    const aNet = netA[teller] ? netA[teller].net : null;
    const bNet = netB[teller] ? netB[teller].net : null;
    const diff = (aNet !== null && bNet !== null) ? aNet + bNet : null;
    const ok   = diff !== null && Math.abs(diff) < 0.005;   // floating-point tolerance

    if (diff !== null) {
      ok ? balanced++ : unbalanced++;
      totA    += aNet;
      totB    += bNet;
      totDiff += diff;
    }

    const fmtCell = (n) => n !== null
      ? `<td class="num">${(n < 0 ? '−' : '') + fmtAmt(Math.abs(n))}</td>`
      : `<td class="na-cell">—</td>`;

    const diffCls  = diff === null ? 'na-cell'
                   : ok            ? 'diff-zero'
                   :                 'diff-negative';

    const diffCell = diff !== null
      ? `<td class="num ${diffCls}">${(diff < 0 ? '−' : '') + fmtAmt(Math.abs(diff))}</td>`
      : `<td class="na-cell">—</td>`;

    const statusHtml = diff === null
      ? '<span class="tally-badge tally-missing">&#9888; Missing</span>'
      : ok
        ? '<span class="tally-badge tally-match">&#10003; Balanced</span>'
        : '<span class="tally-badge tally-diff">&#10007; Unbalanced</span>';

    const tr = document.createElement('tr');
    tr.className = diff === null ? 'tally-row-missing' : ok ? 'tally-row-match' : 'tally-row-diff';
    tr.innerHTML = `
      <td class="teller-id-cell">${escHtml(teller)}</td>
      ${fmtCell(aNet)}
      ${fmtCell(bNet)}
      ${diffCell}
      <td class="status-cell">${statusHtml}</td>
    `;
    tbody.appendChild(tr);
  });

  // Footer totals
  const grandOk       = Math.abs(totDiff) < 0.005;
  const totDiffClass  = grandOk ? 'diff-zero' : 'diff-negative';
  const totSign       = (n) => n < 0 ? '−' : '';

  setCell('v2-recon-tot-a',    (totA < 0 ? '−' : '') + fmtAmt(Math.abs(totA)));
  setCell('v2-recon-tot-b',    (totB < 0 ? '−' : '') + fmtAmt(Math.abs(totB)));

  const totDiffEl = document.getElementById('v2-recon-tot-diff');
  if (totDiffEl) {
    totDiffEl.textContent = totSign(totDiff) + fmtAmt(Math.abs(totDiff));
    totDiffEl.className   = `num col-net ${totDiffClass}`;
  }

  const totStatusEl = document.getElementById('v2-recon-tot-status');
  if (totStatusEl) {
    totStatusEl.innerHTML = grandOk
      ? '<span class="tally-badge tally-match">&#10003; Balanced</span>'
      : '<span class="tally-badge tally-diff">&#10007; Unbalanced</span>';
  }

  // Grand status badge in card header
  const grandEl = document.getElementById('v2-recon-grand');
  if (grandEl) {
    grandEl.textContent = grandOk
      ? `✓ Balanced (${balanced}/${allTellers.length})`
      : `✗ ${unbalanced} unbalanced`;
    grandEl.className = `v2-recon-grand ${grandOk ? 'balanced' : 'unbalanced'}`;
  }
}

