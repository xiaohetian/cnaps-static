/* ==========================================================================
   财税工作台 · Web 版前端
   税费计算全部走后端 API（与桌面版共用 tax 包），前端不做任何重复实现。
   ========================================================================== */
'use strict';

// ==================== 基础工具 ====================

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

const fmt = v => (Math.round(v * 100) / 100).toFixed(2) + ' 元';
const fmtInt = v => Math.round(v) + ' 元';
const ratePct = v => (v === 0 ? '—' : (v * 100).toFixed(0) + '%');
const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };

const VAT_RATES = { '3%': 0.03, '5%': 0.05, '6%': 0.06, '9%': 0.09, '13%': 0.13 };
const parseRate = s => (VAT_RATES[s] !== undefined ? VAT_RATES[s] : 0.03);
const parseFee = s => { const n = parseFloat(String(s).replace('%', '')); return isNaN(n) ? 0 : n / 100; };
const cityRatio = region => (region && region.indexOf('乡镇') === 0) ? 0.05 : 0.07;
const radioValue = name => { const el = $('input[name="' + name + '"]:checked'); return el ? el.value : ''; };

function debounce(fn, ms) {
  let t = null;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}

// ==================== 轻提示 ====================

function toast(msg, kind) {
  const wrap = $('#toast-wrap');
  const el = document.createElement('div');
  el.className = 'toast' + (kind ? ' is-' + kind : '');
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .2s';
    setTimeout(() => el.remove(), 240);
  }, 2000);
}

// ==================== 访问令牌 ====================

const TOKEN_KEY = 'cnaps_token';
let token = localStorage.getItem(TOKEN_KEY) || '';

let bankPromise = null;
function ensureBank() {
  if (!bankPromise) {
    bankPromise = fetch('data/banks.json')
      .then(r => { if (!r.ok) throw new Error('数据加载失败'); return r.json(); })
      .then(rows => { CnapsBank.init(rows); return rows; });
  }
  return bankPromise;
}

// 纯静态：把原来的 REST 调用映射到本地 JS 模块，响应结构与原接口一致。
async function api(path, opts) {
  const body = (opts && opts.body) || {};
  const route = String(path).split('?')[0];
  switch (route) {
    case '/api/health': {
      const rows = await ensureBank();
      return { ok: true, records: rows.length, authed: false };
    }
    case '/api/query': {
      await ensureBank();
      const q = new URL(path, location.href).searchParams.get('q') || '';
      return CnapsBank.query(q, 500);
    }
    case '/api/batch':
      await ensureBank();
      return CnapsBank.batch(body.names || []);
    case '/api/calc/income': return CnapsTax.calcIncome(body);
    case '/api/calc/labor-remuneration': return CnapsTax.calcLaborRemuneration(body);
    case '/api/calc/invoice': return CnapsTax.calcInvoice(body);
    case '/api/calc/labor': return CnapsTax.calcLabor(body);
    case '/api/calc/reverse': return CnapsTax.calcReverse(body);
    default: throw new Error('未知接口：' + path);
  }
}

// reportError 统一处理接口异常：静默错误（如 401）不弹提示。
function reportError(e) {
  if (!e || !e.silent) toast(e && e.message ? e.message : String(e), 'error');
}

// ==================== 弹窗 ====================

const modalMask = $('#modal-mask');
let modalOkHandler = null;
let tokenModalOpen = false; // 令牌框是否已弹出（防止并发 401 反复重建、冲掉用户已输入的内容）

function showModal(title, bodyHTML, okText) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = bodyHTML;
  const okBtn = $('#modal-ok');
  okBtn.hidden = !okText;
  okBtn.textContent = okText || '确定';
  $('#modal-cancel').textContent = okText ? '取消' : '关闭';
  modalMask.hidden = false;
}

function closeModal() {
  modalMask.hidden = true;
  modalOkHandler = null;
  tokenModalOpen = false;
}

function openAboutModal() {
  showModal('关于 财税工作台',
    '<div class="row"><span class="k">版本</span><span>v1.3.1</span></div>' +
    '<div class="row"><span class="k">作者</span><span>小河田</span></div>' +
    '<div class="row"><span class="k">简介</span><span>银行联行号查询 · 税费计算工具</span></div>' +
    '<div class="row"><span class="k">说明</span><span>Web 版仅含联行号查询与税费计算器两项功能</span></div>',
    null);
}

function openTokenModal() {
  // 页面加载时 5 个计算器会并发请求，可能同时收到 401。
  // 令牌框已经打开就不再重建 DOM，否则会冲掉用户正在输入的内容。
  if (tokenModalOpen) return;
  tokenModalOpen = true;
  showModal('访问令牌',
    '<div class="row"><input id="token-input" type="password" placeholder="粘贴服务端 CNAPS_TOKEN" autocomplete="off"></div>' +
    '<div class="tip">留空表示不使用令牌（仅限本机访问）。令牌保存在本机浏览器 localStorage。</div>',
    '保存');
  modalOkHandler = () => {
    const v = ($('#token-input') && $('#token-input').value || '').trim();
    token = v;
    if (v) localStorage.setItem(TOKEN_KEY, v); else localStorage.removeItem(TOKEN_KEY);
    closeModal();
    toast('令牌已保存', 'success');
    checkHealth();
    refreshCalcs();
  };
}

// ==================== 页签 ====================

function bindMainTabs() {
  const bar = $('#main-tabs');
  bar.addEventListener('click', e => {
    const btn = e.target.closest('.app-tab');
    if (!btn) return;
    const id = btn.dataset.target;
    $$('.app-tab', bar).forEach(b => b.classList.toggle('is-active', b === btn));
    $$('.pane').forEach(p => p.classList.toggle('is-active', p.id === id));
  });
}

function bindSubTabs(containerId, scopeId) {
  const box = $('#' + containerId);
  box.addEventListener('click', e => {
    const btn = e.target.closest('.subtab');
    if (!btn) return;
    const id = btn.dataset.target;
    $$('.subtab', box).forEach(b => b.classList.toggle('is-active', b === btn));
    const scope = $('#' + scopeId);
    $$('.subpane', scope).forEach(p => p.classList.toggle('is-active', p.id === id));
  });
}

// ==================== 复制到剪贴板 ====================

async function copyText(text) {
  // 优先用异步剪贴板 API；非安全上下文（http + 非 localhost）回退到 execCommand。
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) { /* 落到回退分支 */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '-1000px';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  ta.remove();
  return ok;
}

// ==================== 联行号：单个查询 ====================

let bankRows = [];
let bankSelected = -1;
let bankTimer = null;

const bankKeyword = $('#bank-keyword');
const bankStatus = $('#bank-status');

bankKeyword.addEventListener('input', () => {
  clearTimeout(bankTimer);
  bankTimer = setTimeout(doBankSearch, 300);
});
bankKeyword.addEventListener('keydown', e => {
  if (e.key === 'Enter') { clearTimeout(bankTimer); doBankSearch(); }
});

async function doBankSearch() {
  const kw = bankKeyword.value.trim();
  if (!kw) {
    renderBank([]);
    bankStatus.textContent = '输入关键词开始搜索';
    return;
  }
  bankStatus.textContent = '查询中…';
  try {
    const rows = await api('/api/query?q=' + encodeURIComponent(kw));
    renderBank(rows);
    bankStatus.textContent = rows.length >= 500
      ? '结果过多，仅显示前 500 条，请缩小关键词'
      : '共 ' + rows.length + ' 条结果';
  } catch (e) {
    bankStatus.textContent = '查询失败：' + e.message;
    toast(e.message, 'error');
  }
}

function renderBank(rows) {
  bankRows = rows;
  bankSelected = -1;
  const tbody = $('#bank-table tbody');
  tbody.textContent = '';
  rows.forEach((r, i) => {
    const tr = document.createElement('tr');
    const tdCnap = document.createElement('td');
    tdCnap.className = 'col-cnap';
    tdCnap.textContent = r.cnap;
    const tdName = document.createElement('td');
    tdName.textContent = r.bankname;
    tr.appendChild(tdCnap);
    tr.appendChild(tdName);
    tr.addEventListener('click', () => selectBankRow(i));
    tbody.appendChild(tr);
  });
  $('#bank-empty').hidden = rows.length > 0;
  $('#bank-copy-cnap').disabled = true;
  $('#bank-copy-name').disabled = true;
}

function selectBankRow(i) {
  bankSelected = i;
  const trs = $$('#bank-table tbody tr');
  trs.forEach((tr, idx) => tr.classList.toggle('is-selected', idx === i));
  $('#bank-copy-cnap').disabled = false;
  $('#bank-copy-name').disabled = false;
}

$('#bank-copy-cnap').addEventListener('click', async () => {
  if (bankSelected < 0) return;
  const ok = await copyText(bankRows[bankSelected].cnap);
  toast(ok ? '已复制' : '复制失败', ok ? 'success' : 'error');
});

$('#bank-copy-name').addEventListener('click', async () => {
  if (bankSelected < 0) return;
  const ok = await copyText(bankRows[bankSelected].bankname);
  toast(ok ? '已复制' : '复制失败', ok ? 'success' : 'error');
});

// ==================== 联行号：批量查询 ====================

let batchRows = [];

$('#batch-run').addEventListener('click', doBatch);
$('#batch-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) doBatch();
});

async function doBatch() {
  const names = $('#batch-input').value.split('\n').map(s => s.trim()).filter(s => s !== '');
  if (!names.length) {
    $('#batch-status').textContent = '请先输入开户行名称';
    return;
  }
  const btn = $('#batch-run');
  btn.disabled = true;
  btn.textContent = '查询中…';
  $('#batch-status').textContent = '查询中…';
  try {
    const rows = await api('/api/batch', { method: 'POST', body: { names } });
    batchRows = rows;
    renderBatch(rows);
    const miss = rows.filter(r => !r.found).length;
    $('#batch-status').textContent = '共 ' + rows.length + ' 条，查到 ' + (rows.length - miss) + ' 条，未查到 ' + miss + ' 条';
  } catch (e) {
    $('#batch-status').textContent = '查询失败：' + e.message;
    toast(e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '批量查询';
  }
}

function renderBatch(rows) {
  const tbody = $('#batch-table tbody');
  tbody.textContent = '';
  rows.forEach(r => {
    const tr = document.createElement('tr');
    tr.style.cursor = 'default';

    const tdIn = document.createElement('td');
    tdIn.textContent = r.input;

    const tdCnap = document.createElement('td');
    tdCnap.className = 'col-cnap';
    if (r.found) {
      tdCnap.textContent = r.cnap;
    } else {
      const tag = document.createElement('span');
      tag.className = 'tag-miss';
      tag.textContent = '没查到';
      tdCnap.appendChild(tag);
    }

    const tdName = document.createElement('td');
    tdName.textContent = r.bankname;

    tr.appendChild(tdIn);
    tr.appendChild(tdCnap);
    tr.appendChild(tdName);
    tbody.appendChild(tr);
  });
  $('#batch-empty').hidden = rows.length > 0;
  $('#batch-copy-cnap').disabled = rows.length === 0;
  $('#batch-copy-name').disabled = rows.length === 0;
}

$('#batch-copy-cnap').addEventListener('click', async () => {
  const text = batchRows.map(r => r.found ? r.cnap : '没查到').join('\n');
  const ok = await copyText(text);
  toast(ok ? '已复制联行号列' : '复制失败', ok ? 'success' : 'error');
});

$('#batch-copy-name').addEventListener('click', async () => {
  const text = batchRows.map(r => r.found ? r.bankname : '没查到').join('\n');
  const ok = await copyText(text);
  toast(ok ? '已复制银行名称列' : '复制失败', ok ? 'success' : 'error');
});

// ==================== 税费计算器 ====================

function setFeeOptions(containerId, values, selected) {
  const box = $('#' + containerId);
  box.textContent = '';
  values.forEach(v => {
    const label = document.createElement('label');
    label.className = 'radio';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = containerId;
    input.value = v;
    if (v === selected) input.checked = true;
    const span = document.createElement('span');
    span.textContent = v;
    label.appendChild(input);
    label.appendChild(span);
    box.appendChild(label);
  });
}

async function calcIncome() {
  try {
    const r = await api('/api/calc/income', {
      method: 'POST',
      body: {
        months: parseInt($('#inc-months').value, 10) || 1,
        cumIncome: num($('#inc-income').value),
        cumSocial: num($('#inc-social').value),
        cumSpecial: num($('#inc-special').value),
        paidBefore: num($('#inc-paid').value),
      },
    });
    $('#inc-out-taxable').textContent = fmt(r.cumTaxable);
    $('#inc-out-rate').textContent = ratePct(r.rate);
    $('#inc-out-quick').textContent = fmt(r.quick);
    $('#inc-out-cumtax').textContent = fmt(r.cumTax);
    $('#inc-out-thistax').textContent = fmt(r.thisTax);
  } catch (e) { reportError(e); }
}

async function calcLaborRem() {
  try {
    const r = await api('/api/calc/labor-remuneration', {
      method: 'POST',
      body: {
        resident: radioValue('lr-ident') === '居民个人',
        income: num($('#lr-income').value),
      },
    });
    $('#lr-out-deduct').textContent = fmt(r.deduct);
    $('#lr-out-taxable').textContent = fmt(r.taxable);
    $('#lr-out-rate').textContent = ratePct(r.rate);
    $('#lr-out-quick').textContent = fmt(r.quick);
    $('#lr-out-tax').textContent = fmt(r.taxAmt);
  } catch (e) { reportError(e); }
}

async function calcInvoice() {
  try {
    const r = await api('/api/calc/invoice', {
      method: 'POST',
      body: {
        amount: num($('#inv-amount').value),
        rate: parseRate(radioValue('inv-rate')),
        cityRatio: cityRatio(radioValue('inv-region')),
        inclusive: radioValue('inv-mode') === '含税金额',
      },
    });
    $('#inv-out-vat').textContent = fmt(r.vat);
    $('#inv-out-city').textContent = fmt(r.cityTax);
    $('#inv-out-edu').textContent = fmt(r.eduSurcharge);
    $('#inv-out-local').textContent = fmt(r.localEdu);
    $('#inv-out-surch').textContent = fmt(r.surcharges);
    $('#inv-out-stamp').textContent = fmt(r.stampDuty);
    $('#inv-out-total').textContent = fmt(r.taxInclusive);
    $('#inv-out-payable').textContent = fmt(r.totalPayable);
  } catch (e) { reportError(e); }
}

async function calcLabor() {
  const algA = radioValue('lab-alg') === 'A（含税）';
  try {
    const r = await api('/api/calc/labor', {
      method: 'POST',
      body: {
        amount: num($('#lab-amount').value),
        vatRate: parseRate(radioValue('lab-rate')),
        cityRatio: cityRatio(radioValue('lab-region')),
        feeRatio: parseFee(radioValue('lab-fee')),
        inclusive: radioValue('lab-mode') === '含税金额',
        algA,
      },
    });
    $('#lab-out-tax').textContent = fmt(r.taxPayable);
    $('#lab-out-fee').textContent = algA ? fmtInt(r.fee) : fmt(r.fee);
    $('#lab-out-total').textContent = algA ? fmtInt(r.total) : fmt(r.total);
  } catch (e) { reportError(e); }
}

async function calcReverse() {
  const algA = radioValue('rev-alg') === 'A（含税）';
  try {
    const r = await api('/api/calc/reverse', {
      method: 'POST',
      body: {
        target: num($('#rev-target').value),
        feeRate: parseFee(radioValue('rev-fee')),
        taxRate: parseRate(radioValue('rev-rate')),
        cityRatio: cityRatio(radioValue('rev-region')),
        algA,
      },
    });
    $('#rev-out-invoice').textContent = fmt(r.invoice);
    $('#rev-out-vat').textContent = fmt(r.vat);
    $('#rev-out-city').textContent = fmt(r.cityTax);
    $('#rev-out-edu').textContent = fmt(r.eduSurcharge);
    $('#rev-out-local').textContent = fmt(r.localEdu);
    $('#rev-out-stamp').textContent = fmt(r.stampDuty);
    $('#rev-out-fee').textContent = fmtInt(r.mgmtFee);
    $('#rev-out-tax').textContent = fmt(r.totalTax);
    $('#rev-out-deduct').textContent = fmt(r.totalDeduct);
    $('#rev-out-error').textContent = fmt(r.error);
  } catch (e) { reportError(e); }
}

// 管理费算法切换时重建可选费率（与桌面版一致）
$('#lab-alg').addEventListener('change', () => {
  if (radioValue('lab-alg') === 'A（含税）') setFeeOptions('lab-fee', ['3.8%', '4.3%', '4.5%'], '3.8%');
  else setFeeOptions('lab-fee', ['1.5%', '1.2%', '1%'], '1.5%');
});
$('#rev-alg').addEventListener('change', () => {
  if (radioValue('rev-alg') === 'A（含税）') setFeeOptions('rev-fee', ['3.8%', '4.3%', '4.5%'], '3.8%');
  else setFeeOptions('rev-fee', ['1.5%', '1.2%', '1%', '0%'], '1.2%');
});

// 把某个面板里的所有输入框绑定到同一个重算函数（去抖 180ms）
function bindCalc(rootId, handler) {
  const root = $('#' + rootId);
  const h = debounce(handler, 180);
  $$('input', root).forEach(el => {
    el.addEventListener('input', h);
    el.addEventListener('change', h);
  });
}

// refreshCalcs 重算全部税费页签（令牌变更后、或初始化时调用）。
function refreshCalcs() {
  calcIncome();
  calcLaborRem();
  calcInvoice();
  calcLabor();
  calcReverse();
}

// ==================== 深链（#/bank?q=xxx、#/tax） ====================

// 支持把当前页签写进地址栏，方便手机收藏直达；#/bank?q=工商 还会直接发起查询。
function applyHash() {
  const raw = (location.hash || '').replace(/^#\/?/, '');
  if (!raw) return;
  const parts = raw.split('?');
  const path = parts[0];
  const query = parts[1] || '';

  let pane = null;
  if (path === 'tax') pane = 'pane-tax';
  else if (path === 'bank') pane = 'pane-bank';
  if (!pane) return;

  const btn = $('.app-tab[data-target="' + pane + '"]');
  if (btn && !btn.classList.contains('is-active')) btn.click();

  if (pane === 'pane-bank' && query) {
    const kw = new URLSearchParams(query).get('q') || '';
    if (kw) {
      bankKeyword.value = kw;
      doBankSearch();
    }
  }
}

// ==================== 启动 ====================

async function checkHealth() {
  try {
    const r = await api('/api/health');
    if (!r.authed) {
      // 服务端未开令牌：清掉本地残留
      token = '';
      localStorage.removeItem(TOKEN_KEY);
    }
  } catch (e) { /* 静默：页面仍可显示 */ }
}

function init() {
  bindMainTabs();
  bindSubTabs('bank-subtabs', 'pane-bank');
  bindSubTabs('tax-subtabs', 'pane-tax');

  setFeeOptions('lab-fee', ['1.5%', '1.2%', '1%'], '1.5%');
  setFeeOptions('rev-fee', ['1.5%', '1.2%', '1%', '0%'], '1.2%');

  bindCalc('tax-income', calcIncome);
  bindCalc('tax-laborrem', calcLaborRem);
  bindCalc('tax-invoice', calcInvoice);
  bindCalc('tax-labor', calcLabor);
  bindCalc('tax-reverse', calcReverse);

  $('#btn-about').addEventListener('click', openAboutModal);
  $('#modal-cancel').addEventListener('click', closeModal);
  $('#modal-ok').addEventListener('click', () => { if (modalOkHandler) modalOkHandler(); });
  modalMask.addEventListener('click', e => { if (e.target === modalMask) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modalMask.hidden) closeModal(); });

  checkHealth();
  applyHash();
  window.addEventListener('hashchange', applyHash);
  refreshCalcs();
}

document.addEventListener('DOMContentLoaded', init);
