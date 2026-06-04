/* ===== Constants ===== */
const DOW_JP = ['日', '月', '火', '水', '木', '金', '土'];
const TYPE_ICON = { running: '🏃', rest: '💤', manual: '📝' };
const TYPE_LABEL = { running: 'ランニング', rest: 'ランオフ', manual: '手動記録' };

const COLUMNS = [
  { id: 'checkbox',                label: '',          width: 40,  sticky: 1, noSort: true },
  { id: 'type',                    label: '',          width: 36,  sticky: 2, noSort: true },
  { id: 'date',                    label: '日付',      width: 88,  sticky: 3 },
  { id: 'dow',                     label: '曜',        width: 36,  sticky: 4, noSort: true },
  { id: 'menu',                    label: '練習メニュー', width: 140, sticky: 5, editable: true, suggest: true },
  { id: 'memo',                    label: 'メモ',      width: 130, editable: true, multiline: true },
  { id: 'locate',                  label: '場所',      width: 90,  editable: true, suggest: true },
  { id: 'shoes',                   label: 'シューズ',  width: 95,  editable: true, type: 'shoes-select' },
  { id: 'distance_km',             label: 'km',        width: 60,  num: true },
  { id: 'duration_s',              label: 'タイム',    width: 72,  num: true, fmt: 'duration' },
  { id: 'pace_per_km_s',           label: 'ペース',    width: 62,  num: true, fmt: 'pace' },
  { id: 'avg_hr_pct',              label: 'HR%',       width: 55,  num: true },
  { id: 'elevation_m',             label: '標高',      width: 60,  num: true },
  // CS列（cadence_score）はメインテーブルに表示しない（設計書 3.2節 L列）
  { id: 'energy_kcal',             label: 'kcal',      width: 58,  num: true },
  { id: 'title',                   label: 'タイトル',  width: 120 },
  { id: 'trimp',                   label: 'TRIMP',     width: 55,  num: true },
  { id: 'vo2max',                  label: 'VO2max',    width: 62,  num: true },
  // バイオメカニクス（常時表示・非表示不可）設計書 7.1節
  { id: 'ground_contact_ms',       label: 'GC',        width: 62,  num: true },
  { id: 'vertical_oscillation_cm', label: 'VO',        width: 58,  num: true },
  { id: 'stride_length_cm',        label: 'Stride',    width: 64,  num: true },
  { id: 'gcb_left_pct',            label: 'GCB',       width: 110, num: true },
  // 以下は非表示（bio: true）
  { id: 'cadence_max_spm',         label: 'Cad最大',   width: 66,  num: true, bio: true },
  { id: 'cadence_avg_spm',         label: 'Cad平均',   width: 66,  num: true, bio: true },
  { id: 'gc_balance',              label: 'GC左右',    width: 88,  bio: true },
  { id: 'impression',              label: '感想',      width: 140, editable: true, multiline: true },
  { id: 'claude_eval',             label: 'Claude評価',width: 200, aiCol: true },
  { id: 'gpt_eval',                label: 'GPT評価',   width: 200, aiCol: true },
  { id: 'actions',                 label: '',          width: 90,  noSort: true },
];

/* ===== State ===== */
const S = {
  months: [],
  currentMonth: null,
  sessions: [],
  phases: [],
  shoes: [],
  filters: { types: { running: true, rest: true, manual: true }, text: '' },
  sort: { col: 'date', dir: 'asc' },
  selectedIds: new Set(),
  activePanel: null,
  editingCell: null,
  aiSettings: null,
};

/* ===== API ===== */
const api = {
  async get(url) { const r = await fetch(url); if (!r.ok) throw new Error(await r.text()); return r.json(); },
  async post(url, body) { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(await r.text()); return r.json(); },
  async patch(url, body) { const r = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(await r.text()); return r.json(); },
  async del(url) { const r = await fetch(url, { method: 'DELETE' }); if (!r.ok) throw new Error(await r.text()); return r.json(); },
};

/* ===== Formatters ===== */
function fmtDuration(s) {
  if (s == null || s === '') return '';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  return `${m}:${String(sec).padStart(2,'0')}`;
}
function fmtPace(s) {
  if (s == null || s === '') return '';
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2,'0')}`;
}
function fmtNum(v, decimals = 1) {
  if (v == null || v === '') return '';
  return Number(v).toFixed(decimals);
}
function formatCell(col, session) {
  const v = session[col.id];
  if (col.fmt === 'duration') return fmtDuration(v);
  if (col.fmt === 'pace') return v ? fmtPace(v) + '/km' : '';
  if (col.num && v != null) {
    if (col.id === 'distance_km') return fmtNum(v) + 'km';
    if (col.id === 'avg_hr_pct') return typeof v === 'number' ? Math.round(v) + '%' : v;
    if (col.id === 'elevation_m') return typeof v === 'number' ? Math.round(v) + 'm' : v;
    if (col.id === 'energy_kcal') return typeof v === 'number' ? Math.round(v) + 'kcal' : v;
    if (col.id === 'trimp') return typeof v === 'number' ? Math.round(v) : v;
    if (col.id === 'vo2max') return fmtNum(v);
    if (col.id === 'ground_contact_ms') return typeof v === 'number' ? Math.round(v) + 'ms' : v;
    if (col.id === 'vertical_oscillation_cm') return fmtNum(v) + 'cm';
    if (col.id === 'stride_length_cm') return fmtNum(v) + 'cm';
    if (col.id === 'gcb_left_pct') return v.toFixed(1) + '% - ' + (100 - v).toFixed(1) + '%';
    return typeof v === 'number' ? (Number.isInteger(v) ? v : fmtNum(v)) : v;
  }
  return v != null ? String(v) : '';
}
function dow(dateStr) {
  if (!dateStr) return '';
  return DOW_JP[new Date(dateStr + 'T00:00:00').getDay()];
}
function fmtMonthLabel(ym) {
  if (!ym) return '';
  const [y, m] = ym.split('-');
  return `${y}年${parseInt(m)}月`;
}

/* ===== Toast ===== */
function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

/* ===== Init ===== */
async function init() {
  await Promise.all([loadPhases(), loadShoes(), loadAISettings()]);
  S.months = await api.get('/api/sessions/months');
  if (S.months.length === 0) {
    S.currentMonth = new Date().toISOString().slice(0, 7);
  } else {
    S.currentMonth = S.months[S.months.length - 1];
  }
  await loadSessions();
  renderTable();
  renderMonthNav();
  renderStatusBar();
  initEvents();
}

async function loadSessions() {
  S.sessions = await api.get('/api/sessions?month=' + S.currentMonth);
}
async function loadPhases() {
  S.phases = await api.get('/api/phases');
}
async function loadShoes() {
  S.shoes = await api.get('/api/shoes');
}
async function loadAISettings() {
  try { S.aiSettings = await api.get('/api/ai/settings'); } catch(e) {}
}

/* ===== Month Navigation ===== */
function renderMonthNav() {
  document.getElementById('month-label').textContent = fmtMonthLabel(S.currentMonth);
  const idx = S.months.indexOf(S.currentMonth);
  document.getElementById('btn-prev-month').disabled = idx <= 0;
  document.getElementById('btn-next-month').disabled = idx >= S.months.length - 1;
}

/* ===== Filter & Sort ===== */
function getFilteredSessions() {
  let rows = S.sessions.filter(s => S.filters.types[s.activity_type]);
  if (S.filters.text) {
    const q = S.filters.text.toLowerCase();
    rows = rows.filter(s =>
      (s.menu || '').toLowerCase().includes(q) ||
      (s.memo || '').toLowerCase().includes(q) ||
      (s.impression || '').toLowerCase().includes(q) ||
      (s.claude_eval || '').toLowerCase().includes(q) ||
      (s.gpt_eval || '').toLowerCase().includes(q) ||
      (s.locate || '').toLowerCase().includes(q)
    );
  }
  const { col, dir } = S.sort;
  rows.sort((a, b) => {
    let va = a[col], vb = b[col];
    if (col === 'date') { va = a.date + a.created_at; vb = b.date + b.created_at; }
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === 'number') return dir === 'asc' ? va - vb : vb - va;
    return dir === 'asc' ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
  });
  return rows;
}

function buildDisplayRows(sessions) {
  // Interleave phase summary rows after last session of each phase in this month
  const rows = [];
  const phaseEnds = {};

  for (const s of sessions) {
    if (!s.phase_id) continue;
    phaseEnds[s.phase_id] = s.date;
  }

  // Find phases whose end_date falls within this month
  const phasesEndingThisMonth = S.phases.filter(p => {
    if (!p.end_date) return false;
    return p.end_date.startsWith(S.currentMonth);
  });

  for (const s of sessions) {
    rows.push({ kind: 'session', session: s });
    for (const p of phasesEndingThisMonth) {
      if (p.end_date === s.date && s.phase_id === p.id) {
        const phaseSessions = S.sessions.filter(ps => ps.phase_id === p.id && ps.activity_type === 'running');
        const totalDist = phaseSessions.reduce((acc, ps) => acc + (ps.distance_km || 0), 0);
        const totalTrimp = phaseSessions.reduce((acc, ps) => acc + (ps.trimp || 0), 0);
        const avgTrimp = phaseSessions.length ? totalTrimp / phaseSessions.length : 0;
        rows.push({ kind: 'phase-summary', phase: p, totalDist, totalTrimp, avgTrimp, count: phaseSessions.length });
      }
    }
  }

  // Also show current phase summary at end of list if phase has no end_date
  const currentPhase = S.phases.find(p => !p.end_date);
  if (currentPhase && sessions.some(s => s.phase_id === currentPhase.id)) {
    const alreadyAdded = rows.some(r => r.kind === 'phase-summary' && r.phase.id === currentPhase.id);
    if (!alreadyAdded) {
      const phaseSessions = S.sessions.filter(s => s.phase_id === currentPhase.id && s.activity_type === 'running');
      const totalDist = phaseSessions.reduce((acc, s) => acc + (s.distance_km || 0), 0);
      const totalTrimp = phaseSessions.reduce((acc, s) => acc + (s.trimp || 0), 0);
      const avgTrimp = phaseSessions.length ? totalTrimp / phaseSessions.length : 0;
      rows.push({ kind: 'phase-summary', phase: currentPhase, totalDist, totalTrimp, avgTrimp, count: phaseSessions.length });
    }
  }

  return rows;
}

/* ===== Table Rendering ===== */
function renderTable() {
  renderThead();
  renderTbody();
}

function renderThead() {
  const thead = document.getElementById('session-thead');
  const visibleCols = COLUMNS.filter(c => !c.bio);
  const tr = document.createElement('tr');
  for (const col of visibleCols) {
    const th = document.createElement('th');
    th.style.width = col.width + 'px';
    th.style.minWidth = col.width + 'px';
    if (col.sticky) th.className = 'col-sticky-' + col.sticky;
    if (col.bio) th.classList.add('bio-col');
    if (!col.noSort) {
      th.dataset.sort = col.id;
      if (S.sort.col === col.id) th.className += (S.sort.dir === 'asc' ? ' sort-asc' : ' sort-desc');
    }
    th.textContent = col.label;
    tr.appendChild(th);
  }
  thead.innerHTML = '';
  thead.appendChild(tr);
}

function renderTbody() {
  const tbody = document.getElementById('session-tbody');
  const sessions = getFilteredSessions();
  const rows = buildDisplayRows(sessions);

  const dateCounts = {};
  for (const r of rows) {
    if (r.kind === 'session') dateCounts[r.session.date] = (dateCounts[r.session.date] || 0) + 1;
  }

  tbody.innerHTML = '';
  let prevDate = null;
  for (const row of rows) {
    if (row.kind === 'phase-summary') {
      tbody.appendChild(buildPhaseSummaryRow(row));
      prevDate = null;
    } else {
      const s = row.session;
      const isGroupStart = s.date !== prevDate;
      tbody.appendChild(buildSessionRow(s, isGroupStart, dateCounts[s.date] > 1));
      prevDate = s.date;
    }
  }
  renderStatusBar();
}

const SESSION_TYPE_LABEL = { warmup: 'WU', main: 'M', cooldown: 'CD' };
const SESSION_TYPE_COLOR = { warmup: '#60a5fa', main: 'var(--green)', cooldown: '#a78bfa' };

function buildSessionRow(s, isGroupStart = true, isMultiDay = false) {
  const tr = document.createElement('tr');
  tr.dataset.id = s.id;
  tr.className = 'row-' + s.activity_type;
  if (isGroupStart) tr.classList.add('row-date-group-start');
  if (s.source === 'ai_generated') tr.classList.add('row-ai-generated');
  if (S.selectedIds.has(s.id)) tr.classList.add('row-selected');

  const visibleCols = COLUMNS.filter(c => !c.bio);
  for (const col of visibleCols) {
    const td = document.createElement('td');
    if (col.sticky) td.className = 'col-sticky-' + col.sticky;
    if (col.bio) td.classList.add('bio-col');

    if (col.id === 'checkbox') {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'row-cb';
      cb.checked = S.selectedIds.has(s.id);
      td.appendChild(cb);
    } else if (col.id === 'type') {
      td.className += ' cell-type';
      td.title = TYPE_LABEL[s.activity_type] || '';
      const icon = document.createElement('div');
      icon.textContent = TYPE_ICON[s.activity_type] || '?';
      td.appendChild(icon);
      if (s.session_type && isMultiDay) {
        const badge = document.createElement('div');
        badge.className = 'session-type-badge';
        badge.textContent = SESSION_TYPE_LABEL[s.session_type] || '';
        badge.style.background = SESSION_TYPE_COLOR[s.session_type] || 'var(--text-muted)';
        td.appendChild(badge);
      }
    } else if (col.id === 'date') {
      if (isGroupStart) td.textContent = s.date;
    } else if (col.id === 'dow') {
      if (isGroupStart) {
        const d = dow(s.date);
        td.textContent = d;
        if (d === '土') td.style.color = '#3b82f6';
        if (d === '日') td.style.color = '#ef4444';
      }
    } else if (col.id === 'actions') {
      const cBtn = document.createElement('button');
      cBtn.className = 'btn btn-sm btn-ai claude';
      cBtn.textContent = 'Claude';
      cBtn.title = 'Claude AI評価';
      cBtn.dataset.action = 'eval-claude';
      cBtn.dataset.id = s.id;
      const gBtn = document.createElement('button');
      gBtn.className = 'btn btn-sm btn-ai gpt';
      gBtn.textContent = 'GPT';
      gBtn.title = 'GPT AI評価';
      gBtn.dataset.action = 'eval-gpt';
      gBtn.dataset.id = s.id;
      const delBtn = document.createElement('button');
      delBtn.className = 'delete-btn';
      delBtn.textContent = '🗑';
      delBtn.title = '削除';
      delBtn.dataset.action = 'delete';
      delBtn.dataset.id = s.id;
      td.appendChild(cBtn);
      td.appendChild(gBtn);
      td.appendChild(delBtn);
      td.style.whiteSpace = 'nowrap';
    } else if (col.id === 'claude_eval' || col.id === 'gpt_eval') {
      const v = s[col.id];
      if (v) {
        td.className += ' cell-ai';
        td.textContent = v;
        td.title = v;
      } else {
        td.className += ' cell-ai-empty';
        td.textContent = '—';
      }
    } else if (col.id === 'menu' && s.source === 'ai_generated' && s.planned_menu) {
      td.className += ' cell-wrap cell-menu-ai';
      const isDiff = s.menu && s.menu !== s.planned_menu;
      td.innerHTML =
        `<div class="menu-planned">予定：${escHtml(s.planned_menu)}</div>` +
        `<div class="menu-actual${isDiff ? ' menu-actual-diff' : ''}">実績：${escHtml(s.menu || '—')}</div>`;
      td.dataset.field = col.id;
      td.dataset.id = s.id;
    } else if (col.editable) {
      const v = formatCell(col, s);
      td.className += ' cell-wrap';
      td.textContent = v || '';
      if (!v) td.classList.add('cell-empty');
      td.dataset.field = col.id;
      td.dataset.id = s.id;
    } else {
      const v = formatCell(col, s);
      if (col.num) td.className += ' cell-num';
      td.textContent = v;
      if (!v) td.style.color = 'var(--text-light)';
    }
    tr.appendChild(td);
  }

  // Click to open detail panel
  tr.addEventListener('click', (e) => {
    if (e.target.type === 'checkbox') return;
    if (e.target.closest('button')) return;
    if (e.target.dataset.field) return;
    openDetailPanel(s.id);
  });

  return tr;
}

function buildPhaseSummaryRow(row) {
  const { phase, totalDist, totalTrimp, avgTrimp, count } = row;
  const tr = document.createElement('tr');
  tr.className = 'row-phase-summary';
  const visibleCols = COLUMNS.filter(c => !c.bio);
  const badge = `<span class="color-swatch" style="background:${phase.color}"></span>`;
  const label = `📊 ${phase.name} フェーズまとめ (${phase.start_date} ～ ${phase.end_date || '進行中'})`;
  const summary = `${count}回 / ${totalDist.toFixed(1)}km / TRIMP合計 ${totalTrimp.toFixed(0)} / 平均 ${avgTrimp.toFixed(0)}`;

  for (let i = 0; i < visibleCols.length; i++) {
    const col = visibleCols[i];
    const td = document.createElement('td');
    if (col.sticky) td.className = 'col-sticky-' + col.sticky;
    if (col.bio) td.classList.add('bio-col');
    if (i === 0) td.innerHTML = badge;
    else if (i === 1) td.textContent = '📊';
    else if (i === 2) td.colSpan = 3; // span date/dow/menu
    else if (i === 3 || i === 4) { td.style.display = 'none'; continue; }
    else if (i === 5) { td.colSpan = visibleCols.length - 5; td.textContent = `  ${label} — ${summary}`; }
    else continue;
    tr.appendChild(td);
  }
  return tr;
}

/* ===== Status Bar ===== */
function renderStatusBar() {
  const sessions = getFilteredSessions();
  const running = sessions.filter(s => s.activity_type === 'running');
  const totalDist = running.reduce((a, s) => a + (s.distance_km || 0), 0);
  const totalTrimp = running.reduce((a, s) => a + (s.trimp || 0), 0);
  const selCount = S.selectedIds.size;
  document.getElementById('status-count').innerHTML = `<strong>${sessions.length}</strong> 件表示`;
  document.getElementById('status-selected').innerHTML = selCount ? `<strong>${selCount}</strong> 件選択` : '0件選択';
  document.getElementById('status-distance').innerHTML = `月間距離 <strong>${totalDist.toFixed(1)} km</strong>`;
  document.getElementById('status-trimp').innerHTML = `月間TRIMP <strong>${totalTrimp.toFixed(0)}</strong>`;
  document.getElementById('btn-bulk-claude').disabled = selCount === 0;
  document.getElementById('btn-bulk-gpt').disabled = selCount === 0;
}

/* ===== Inline Editing ===== */
function startCellEdit(td, sessionId, field) {
  if (S.editingCell) commitEdit();
  S.editingCell = { td, sessionId, field };

  const session = S.sessions.find(s => s.id === sessionId);
  const col = COLUMNS.find(c => c.id === field);
  const rawValue = session ? session[field] : '';
  td.classList.add('cell-editing');
  td.classList.remove('cell-empty');

  let input;
  if (col && col.type === 'shoes-select') {
    input = document.createElement('select');
    const empty = document.createElement('option');
    empty.value = ''; empty.textContent = '—';
    input.appendChild(empty);
    for (const shoe of S.shoes.filter(s => s.is_active)) {
      const opt = document.createElement('option');
      opt.value = shoe.name; opt.textContent = shoe.name;
      if (shoe.name === rawValue) opt.selected = true;
      input.appendChild(opt);
    }
  } else if (col && col.multiline) {
    input = document.createElement('textarea');
    input.value = rawValue || '';
    input.rows = 3;
    input.style.minWidth = Math.max(col.width - 10, 120) + 'px';
  } else {
    input = document.createElement('input');
    input.type = 'text';
    input.value = rawValue || '';
    input.style.minWidth = Math.max(col.width - 10, 80) + 'px';
  }

  input.style.width = '100%';
  td.innerHTML = '';
  td.appendChild(input);
  input.focus();
  if (input.select) input.select();

  // Autocomplete for menu/locate
  if (col && col.suggest) {
    input.addEventListener('input', () => showAutocomplete(input, field));
    input.addEventListener('focus', () => showAutocomplete(input, field));
  }

  input.addEventListener('blur', () => setTimeout(commitEdit, 150));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { cancelEdit(); }
    e.stopPropagation();
  });
}

async function commitEdit() {
  if (!S.editingCell) return;
  const { td, sessionId, field } = S.editingCell;
  S.editingCell = null;
  hideAutocomplete();

  const input = td.querySelector('input, textarea, select');
  if (!input) { td.classList.remove('cell-editing'); return; }
  const newValue = input.value;

  td.classList.remove('cell-editing');

  try {
    const updated = await api.patch('/api/sessions/' + sessionId, { [field]: newValue || null });
    const idx = S.sessions.findIndex(s => s.id === sessionId);
    if (idx !== -1) S.sessions[idx] = { ...S.sessions[idx], ...updated };
    const col = COLUMNS.find(c => c.id === field);
    const display = formatCell(col, updated);
    td.textContent = display || '';
    if (!display) td.classList.add('cell-empty');
  } catch(e) {
    toast('保存エラー: ' + e.message, 'error');
    td.textContent = '';
    td.classList.add('cell-empty');
  }
}

function cancelEdit() {
  if (!S.editingCell) return;
  const { td, sessionId, field } = S.editingCell;
  S.editingCell = null;
  hideAutocomplete();
  td.classList.remove('cell-editing');
  const session = S.sessions.find(s => s.id === sessionId);
  const col = COLUMNS.find(c => c.id === field);
  const v = session ? formatCell(col, session) : '';
  td.textContent = v || '';
  if (!v) td.classList.add('cell-empty');
}

/* ===== Autocomplete ===== */
let autocompleteCache = {};
let autocompleteField = null;
let autocompleteInput = null;

async function showAutocomplete(input, field) {
  const q = input.value;
  autocompleteField = field;
  autocompleteInput = input;

  try {
    const suggestions = await api.get(`/api/sessions/autocomplete/${field}?q=${encodeURIComponent(q)}`);
    const list = document.getElementById('autocomplete-list');
    if (!suggestions.length) { hideAutocomplete(); return; }

    list.innerHTML = '';
    for (const s of suggestions) {
      if (s === input.value) continue;
      const item = document.createElement('div');
      item.className = 'autocomplete-item';
      item.textContent = s;
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        input.value = s;
        hideAutocomplete();
        input.blur();
      });
      list.appendChild(item);
    }

    if (!list.children.length) { hideAutocomplete(); return; }
    const rect = input.getBoundingClientRect();
    list.style.left = rect.left + 'px';
    list.style.top = (rect.bottom + 2) + 'px';
    list.style.minWidth = rect.width + 'px';
    list.style.display = 'block';
  } catch(e) { hideAutocomplete(); }
}

function hideAutocomplete() {
  document.getElementById('autocomplete-list').style.display = 'none';
  autocompleteField = null;
  autocompleteInput = null;
}

/* ===== AI Evaluation ===== */
async function evaluateSession(sessionId, provider) {
  const tr = document.querySelector(`tr[data-id="${sessionId}"]`);
  if (!tr) return;

  // Find the correct column cell
  const colIdx = COLUMNS.filter(c => !c.bio || S.showBio).findIndex(c => c.id === (provider === 'claude' ? 'claude_eval' : 'gpt_eval'));
  const tds = tr.querySelectorAll('td');
  const evalTd = tds[colIdx];
  if (evalTd) {
    evalTd.innerHTML = '<span class="ai-loading">⏳</span> 評価中...';
    evalTd.className = '';
  }

  // Also disable the action button
  const btn = tr.querySelector(`[data-action="eval-${provider}"]`);
  if (btn) btn.disabled = true;

  try {
    const result = await api.post('/api/ai/evaluate', { sessionId, provider });
    const idx = S.sessions.findIndex(s => s.id === sessionId);
    if (idx !== -1) {
      const field = provider === 'claude' ? 'claude_eval' : 'gpt_eval';
      S.sessions[idx][field] = result.text;
      S.sessions[idx][field + '_at'] = result.evaluatedAt;
    }
    if (evalTd) {
      evalTd.className = 'cell-ai';
      evalTd.textContent = result.text;
      evalTd.title = result.text;
    }
    toast(`${provider === 'claude' ? 'Claude' : 'GPT'} 評価完了`, 'success');
    // Update detail panel if open
    if (S.activePanel === sessionId) refreshDetailPanel(sessionId);
  } catch(e) {
    if (evalTd) {
      evalTd.className = 'cell-ai-empty';
      evalTd.textContent = 'エラー — リトライ';
    }
    toast('AI評価エラー: ' + e.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function bulkEvaluate(provider) {
  const ids = [...S.selectedIds];
  if (!ids.length) return;
  toast(`${ids.length} 件を評価します...`);
  for (const id of ids) {
    await evaluateSession(id, provider);
    await new Promise(r => setTimeout(r, 300));
  }
}

/* ===== Delete Session ===== */
async function deleteSession(sessionId) {
  if (!confirm('このセッションを削除しますか？')) return;
  try {
    await api.del('/api/sessions/' + sessionId);
    S.sessions = S.sessions.filter(s => s.id !== sessionId);
    S.selectedIds.delete(sessionId);
    // Reload months in case the last session of a month was deleted
    S.months = await api.get('/api/sessions/months');
    renderTbody();
    renderMonthNav();
    toast('削除しました');
  } catch(e) {
    toast('削除エラー: ' + e.message, 'error');
  }
}

/* ===== Detail Panel ===== */
function openDetailPanel(sessionId) {
  S.activePanel = sessionId;
  const session = S.sessions.find(s => s.id === sessionId);
  if (!session) return;
  // Render immediately with session data, then load laps async
  const content = document.getElementById('detail-content');
  content.innerHTML = buildDetailContent(session, null);
  initDetailFormEvents(session);
  document.getElementById('detail-panel').classList.remove('panel-closed');
  document.getElementById('detail-panel').classList.add('panel-open');
  document.getElementById('panel-overlay').style.display = 'block';
  // Load laps asynchronously and update panel
  if (session.activity_type === 'running') {
    loadAndRenderLaps(session);
  }
}

function closeDetailPanel() {
  S.activePanel = null;
  document.getElementById('detail-panel').classList.remove('panel-open');
  document.getElementById('detail-panel').classList.add('panel-closed');
  document.getElementById('panel-overlay').style.display = 'none';
}

function refreshDetailPanel(sessionId) {
  const session = S.sessions.find(s => s.id === sessionId);
  if (!session) return;
  const content = document.getElementById('detail-content');
  content.innerHTML = buildDetailContent(session, S._lastLaps || null);
  initDetailFormEvents(session);
  if (session.activity_type === 'running') loadAndRenderLaps(session);
}

async function loadAndRenderLaps(session) {
  try {
    const laps = await api.get('/api/sessions/' + session.id + '/laps');
    S._lastLaps = laps;
    // Update lap section in panel
    const lapSection = document.getElementById('lap-section');
    const chartSection = document.getElementById('chart-section');
    if (lapSection) lapSection.innerHTML = buildLapTableHtml(laps, session);
    if (chartSection) {
      if (laps.length > 0) {
        chartSection.innerHTML = `
          <h3>ラップグラフ</h3>
          <div class="chart-wrap"><canvas id="lap-chart-pace"></canvas></div>
          <div class="chart-wrap"><canvas id="lap-chart-hr"></canvas></div>
        `;
        initDetailCharts(laps);
      } else {
        chartSection.innerHTML = '';
      }
    }
  } catch(e) {
    console.error('Laps load error:', e);
  }
}

function buildDetailContent(s, laps) {
  const phase = S.phases.find(p => p.id === s.phase_id);
  const phaseBadge = phase ? `<span class="cell-phase-badge" style="background:${phase.color}">${phase.name}</span>` : '';

  const statsHtml = s.activity_type === 'running' ? `
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-value">${fmtNum(s.distance_km)}<small style="font-size:12px">km</small></div><div class="stat-label">距離</div></div>
      <div class="stat-card"><div class="stat-value">${fmtDuration(s.duration_s)}</div><div class="stat-label">タイム</div></div>
      <div class="stat-card"><div class="stat-value">${s.pace_per_km_s ? fmtPace(s.pace_per_km_s) : '—'}</div><div class="stat-label">ペース/km</div></div>
      <div class="stat-card"><div class="stat-value">${s.avg_hr_pct != null ? s.avg_hr_pct + 'bpm' : '—'}</div><div class="stat-label">平均HR</div></div>
      <div class="stat-card"><div class="stat-value">${s.trimp ? Math.round(s.trimp) : '—'}</div><div class="stat-label">TRIMP</div></div>
      <div class="stat-card"><div class="stat-value">${s.vo2max ? fmtNum(s.vo2max) : '—'}</div><div class="stat-label">VO2max</div></div>
    </div>
    ${buildBioStatsHtml(s)}
  ` : '';

  const claudeHtml = s.claude_eval
    ? `<div class="ai-eval-block"><div class="ai-header claude">🤖 Claude 客観評価（${s.claude_eval_at ? s.claude_eval_at.slice(0,10) : ''}）</div>${escHtml(s.claude_eval)}</div>`
    : `<div class="ai-eval-block"><div class="ai-header claude">🤖 Claude 客観評価</div><span style="color:var(--text-light)">未評価</span></div>`;
  const gptHtml = s.gpt_eval
    ? `<div class="ai-eval-block"><div class="ai-header gpt">🟢 GPT コーチング（${s.gpt_eval_at ? s.gpt_eval_at.slice(0,10) : ''}）</div>${escHtml(s.gpt_eval)}</div>`
    : `<div class="ai-eval-block"><div class="ai-header gpt">🟢 GPT コーチング</div><span style="color:var(--text-light)">未評価</span></div>`;

  const shoesOptions = S.shoes.filter(sh => sh.is_active)
    .map(sh => `<option value="${escAttr(sh.name)}" ${s.shoes === sh.name ? 'selected' : ''}>${escHtml(sh.name)}</option>`)
    .join('');

  const lapHtml = s.activity_type === 'running' ? `
    <div class="detail-section" id="lap-section">
      ${laps ? buildLapTableHtml(laps, s) : '<p style="color:var(--text-muted);font-size:12px">ラップデータを読み込み中...</p>'}
    </div>
    <div class="detail-section" id="chart-section">
      ${laps && laps.length > 0 ? `
        <h3>ラップグラフ</h3>
        <div class="chart-wrap"><canvas id="lap-chart-pace"></canvas></div>
        <div class="chart-wrap"><canvas id="lap-chart-hr"></canvas></div>
      ` : '<h3>ラップグラフ</h3><p style="font-size:12px;color:var(--text-muted)">データ読み込み中...</p>'}
    </div>
  ` : '';

  return `
    <div class="detail-date">${s.date} (${dow(s.date)})${phaseBadge} ${TYPE_ICON[s.activity_type]} ${TYPE_LABEL[s.activity_type]}</div>
    <div class="detail-menu">${escHtml(s.menu || s.title || '（メニュー未設定）')}</div>
    ${statsHtml}
    <div class="detail-section">
      <h3>編集フィールド</h3>
      <div class="detail-field"><label>練習メニュー</label><input id="dp-menu" value="${escAttr(s.menu || '')}"></div>
      <div class="detail-field"><label>メモ（練習内容）</label><textarea id="dp-memo">${escHtml(s.memo || '')}</textarea></div>
      <div class="detail-field"><label>場所</label><input id="dp-locate" value="${escAttr(s.locate || '')}"></div>
      <div class="detail-field"><label>シューズ</label><select id="dp-shoes"><option value="">—</option>${shoesOptions}</select></div>
      <div class="detail-field"><label>感想 ★AI送信に必須</label><textarea id="dp-impression" rows="4">${escHtml(s.impression || '')}</textarea></div>
      <button class="detail-save-btn" data-save-id="${s.id}">保存</button>
    </div>
    ${lapHtml}
    <div class="detail-section">
      <h3>AI評価</h3>
      <div style="display:flex;gap:8px;margin-bottom:10px">
        <button class="btn btn-sm btn-ai claude" data-action="eval-claude" data-id="${s.id}" style="flex:1">Claude 評価</button>
        <button class="btn btn-sm btn-ai gpt" data-action="eval-gpt" data-id="${s.id}" style="flex:1">GPT 評価</button>
      </div>
      ${claudeHtml}
      ${gptHtml}
    </div>
  `;
}

function buildBioStatsHtml(s) {
  // Session-level biomechanics only (NOT shown at lap level per design spec)
  if (!s.ground_contact_ms && !s.vertical_oscillation_cm && !s.cadence_avg_spm) return '';
  return `
    <div class="detail-section">
      <h3>バイオメカニクス（セッション平均）</h3>
      <div class="stats-grid">
        ${s.ground_contact_ms ? `<div class="stat-card"><div class="stat-value">${s.ground_contact_ms}<small style="font-size:11px">ms</small></div><div class="stat-label">接地時間</div></div>` : ''}
        ${s.vertical_oscillation_cm ? `<div class="stat-card"><div class="stat-value">${fmtNum(s.vertical_oscillation_cm)}<small style="font-size:11px">cm</small></div><div class="stat-label">上下動</div></div>` : ''}
        ${s.cadence_avg_spm ? `<div class="stat-card"><div class="stat-value">${s.cadence_avg_spm}<small style="font-size:11px">spm</small></div><div class="stat-label">平均Cad</div></div>` : ''}
        ${s.stride_length_cm ? `<div class="stat-card"><div class="stat-value">${s.stride_length_cm}<small style="font-size:11px">cm</small></div><div class="stat-label">歩幅</div></div>` : ''}
        ${s.gcb_left_pct ? `<div class="stat-card"><div class="stat-value" style="font-size:14px">${s.gcb_left_pct.toFixed(1)}% - ${(100 - s.gcb_left_pct).toFixed(1)}%</div><div class="stat-label">GCB（左-右）</div></div>` : ''}
        ${s.elevation_m ? `<div class="stat-card"><div class="stat-value">${s.elevation_m}<small style="font-size:11px">m</small></div><div class="stat-label">累積標高</div></div>` : ''}
      </div>
    </div>
  `;
}

function buildLapTableHtml(laps, s) {
  if (!laps || laps.length === 0) {
    return '<h3>ラップデータ</h3><p style="color:var(--text-muted);font-size:12px">ラップデータがありません</p>';
  }
  // Detect if bio columns are available (from Suunto JSON source)
  const hasBio = laps.some(l => l.ground_contact_ms != null || l.vertical_oscillation_cm != null);

  // Paginate for very long races (e.g. 102 laps)
  const maxRows = 30;
  const shown = laps.length > maxRows ? laps.filter((_, i) => i % Math.ceil(laps.length / maxRows) === 0) : laps;
  const note = laps.length > maxRows
    ? `<p style="font-size:11px;color:var(--text-muted);margin-bottom:4px">全${laps.length}ラップ（${shown.length}件表示）</p>`
    : '';

  let rows = '';
  for (const l of shown) {
    const bioHtml = hasBio ? `
      <td class="cell-num">${l.ground_contact_ms != null ? l.ground_contact_ms + 'ms' : '—'}</td>
      <td class="cell-num">${l.vertical_oscillation_cm != null ? l.vertical_oscillation_cm.toFixed(1) + 'cm' : '—'}</td>
      <td class="cell-num">${l.stride_length_m != null ? l.stride_length_m.toFixed(3) + 'm' : '—'}</td>
      <td class="cell-num">${l.gcb_left_pct != null ? l.gcb_left_pct.toFixed(1) + '% - ' + (100 - l.gcb_left_pct).toFixed(1) + '%' : '—'}</td>
    ` : '';
    rows += `<tr>
      <td>${l.lap_number}</td>
      <td class="cell-num">${fmtNum(l.distance_km)}</td>
      <td class="cell-num">${l.pace_s ? fmtPace(l.pace_s) : '—'}</td>
      <td class="cell-num">${l.avg_hr_pct != null ? l.avg_hr_pct : '—'}</td>
      <td class="cell-num">${l.power_w != null ? l.power_w : '—'}</td>
      <td class="cell-num">${l.cadence_spm != null ? l.cadence_spm : '—'}</td>
      <td class="cell-num">${l.elevation_gain_m != null ? l.elevation_gain_m : '—'}</td>
      ${bioHtml}
    </tr>`;
  }

  const bioHeaders = hasBio
    ? `<th>GC</th><th>VO</th><th>Stride</th><th>GCB</th>`
    : '';

  return `
    <h3>ラップデータ（${laps.length}ラップ）${hasBio ? ' <span style="font-size:10px;font-weight:normal;color:var(--green)">✓ バイオメカニクスあり</span>' : ''}</h3>
    ${note}
    <div style="overflow-x:auto">
    <table class="lap-table">
      <thead><tr><th>Lap</th><th>km</th><th>Pace</th><th>HR</th><th>W</th><th>Cad</th><th>↑m</th>${bioHeaders}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
    </div>
  `;
}

function initDetailCharts(laps) {
  if (!laps || laps.length === 0) return;
  const maxPoints = 50;
  const step = Math.max(1, Math.ceil(laps.length / maxPoints));
  const chartLaps = laps.filter((_, i) => i % step === 0);
  const labels = chartLaps.map(l => `L${l.lap_number}`);
  const ptRadius = laps.length > 20 ? 0 : 3;
  const hasBio = laps.some(l => l.ground_contact_ms != null);

  const paceCtx = document.getElementById('lap-chart-pace');
  const hrCtx = document.getElementById('lap-chart-hr');
  if (!paceCtx || !hrCtx) return;

  new Chart(paceCtx, {
    type: 'line',
    data: {
      labels,
      datasets: [{ label: 'Pace', data: chartLaps.map(l => l.pace_s), borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,.08)', tension: 0.3, fill: true, pointRadius: ptRadius }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => fmtPace(c.raw) + '/km' } } },
      scales: { y: { reverse: true, ticks: { callback: v => fmtPace(v), font: { size: 10 } } }, x: { ticks: { font: { size: 10 } } } }
    }
  });

  new Chart(hrCtx, {
    type: 'line',
    data: {
      labels,
      datasets: [{ label: 'HR', data: chartLaps.map(l => l.avg_hr_pct), borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,.08)', tension: 0.3, fill: true, pointRadius: ptRadius }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { ticks: { font: { size: 10 } } }, x: { ticks: { font: { size: 10 } } } }
    }
  });

  if (hasBio) {
    // Add bio charts (GCT and VO)
    const chartSection = document.getElementById('chart-section');
    if (!chartSection) return;
    ['lap-chart-gct', 'lap-chart-vo'].forEach(id => {
      if (!document.getElementById(id)) {
        const wrap = document.createElement('div');
        wrap.className = 'chart-wrap';
        const canvas = document.createElement('canvas');
        canvas.id = id;
        wrap.appendChild(canvas);
        chartSection.appendChild(wrap);
      }
    });
    new Chart(document.getElementById('lap-chart-gct'), {
      type: 'line',
      data: { labels, datasets: [{ label: '接地時間(ms)', data: chartLaps.map(l => l.ground_contact_ms), borderColor: '#8b5cf6', backgroundColor: 'rgba(139,92,246,.08)', tension: 0.3, fill: true, pointRadius: ptRadius }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { font: { size: 10 } } } }, scales: { y: { ticks: { callback: v => v + 'ms', font: { size: 10 } } }, x: { ticks: { font: { size: 10 } } } } }
    });
    new Chart(document.getElementById('lap-chart-vo'), {
      type: 'line',
      data: { labels, datasets: [{ label: '上下動(cm)', data: chartLaps.map(l => l.vertical_oscillation_cm), borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,.08)', tension: 0.3, fill: true, pointRadius: ptRadius }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { font: { size: 10 } } } }, scales: { y: { ticks: { callback: v => v + 'cm', font: { size: 10 } } }, x: { ticks: { font: { size: 10 } } } } }
    });
  }
}

function initDetailFormEvents(s) {
  const saveBtn = document.querySelector(`.detail-save-btn[data-save-id="${s.id}"]`);
  if (!saveBtn) return;
  saveBtn.addEventListener('click', async () => {
    const updates = {
      menu: document.getElementById('dp-menu').value || null,
      memo: document.getElementById('dp-memo').value || null,
      locate: document.getElementById('dp-locate').value || null,
      shoes: document.getElementById('dp-shoes').value || null,
      impression: document.getElementById('dp-impression').value || null,
    };
    try {
      const updated = await api.patch('/api/sessions/' + s.id, updates);
      const idx = S.sessions.findIndex(x => x.id === s.id);
      if (idx !== -1) S.sessions[idx] = { ...S.sessions[idx], ...updated };
      renderTbody();
      toast('保存しました', 'success');
    } catch(e) { toast('保存エラー: ' + e.message, 'error'); }
  });
}

/* ===== Settings Modal ===== */
function openSettings(tab = 'api') {
  document.getElementById('settings-modal').style.display = 'block';
  renderSettingsTab(tab);
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
    b.onclick = () => {
      document.querySelectorAll('.tab-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      renderSettingsTab(b.dataset.tab);
    };
  });
}
function closeSettings() { document.getElementById('settings-modal').style.display = 'none'; }

function renderSettingsTab(tab) {
  const content = document.getElementById('settings-tab-content');
  if (tab === 'api') content.innerHTML = buildApiTab();
  else if (tab === 'shoes') { content.innerHTML = buildShoesTab(); initShoesTabEvents(); }
  else if (tab === 'phases') { content.innerHTML = buildPhasesTab(); initPhasesTabEvents(); }
  else if (tab === 'columns') content.innerHTML = buildColumnsTab();
  else if (tab === 'data') content.innerHTML = buildDataTab();
}

function buildApiTab() {
  const info = S.aiSettings || { note: '', phase: 1 };
  return `
    <div class="settings-section">
      <h3>AIキー設定</h3>
      <div class="info-box">ℹ️ ${info.note || 'Phase 1ではAI評価はダミーレスポンスです。Phase 2でAPIキーを設定することで実際のAI評価が使えます。'}</div>
      <div class="form-group">
        <label>Anthropic API Key（Phase 2）</label>
        <input type="password" placeholder="sk-ant-..." value="" disabled>
      </div>
      <div class="form-group">
        <label>OpenAI API Key（Phase 2）</label>
        <input type="password" placeholder="sk-..." value="" disabled>
      </div>
      <p style="font-size:11px;color:var(--text-muted)">APIキーは <code>.env</code> ファイルで設定します。</p>
    </div>
  `;
}

function buildShoesTab() {
  const rows = S.shoes.map(s => `
    <div class="list-item" data-shoe-id="${s.id}">
      <div class="list-item-label">
        <div>${escHtml(s.name)}</div>
        <div class="list-item-sub">${s.total_km}km ${s.purchase_date ? '/ 購入: ' + s.purchase_date : ''} ${s.notes ? '/ ' + escHtml(s.notes) : ''}</div>
      </div>
      <span class="tag ${s.is_active ? 'tag-active' : 'tag-retired'}">${s.is_active ? '現役' : '引退'}</span>
      <button class="btn btn-sm" data-shoe-toggle="${s.id}">${s.is_active ? '引退にする' : '現役に戻す'}</button>
    </div>
  `).join('');
  return `
    <div class="settings-section">
      <h3>シューズ管理</h3>
      <div id="shoes-list">${rows || '<p style="color:var(--text-muted)">登録なし</p>'}</div>
      <hr style="margin:16px 0;border:none;border-top:1px solid var(--border)">
      <h3>シューズ追加</h3>
      <div class="form-group"><label>シューズ名</label><input id="new-shoe-name" placeholder="例: neo zen"></div>
      <div class="form-group"><label>購入日</label><input type="date" id="new-shoe-date"></div>
      <div class="form-group"><label>メモ</label><input id="new-shoe-notes" placeholder="用途・特徴など"></div>
      <button class="btn btn-primary" id="btn-add-shoe">追加</button>
    </div>
  `;
}

function initShoesTabEvents() {
  document.getElementById('btn-add-shoe')?.addEventListener('click', async () => {
    const name = document.getElementById('new-shoe-name').value.trim();
    if (!name) { toast('シューズ名を入力してください', 'error'); return; }
    await api.post('/api/shoes', { name, purchase_date: document.getElementById('new-shoe-date').value, notes: document.getElementById('new-shoe-notes').value });
    await loadShoes();
    renderSettingsTab('shoes');
    toast('シューズを追加しました', 'success');
  });

  document.querySelectorAll('[data-shoe-toggle]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.shoeToggle;
      const shoe = S.shoes.find(s => s.id === id);
      if (!shoe) return;
      await api.patch('/api/shoes/' + id, { ...shoe, is_active: shoe.is_active ? 0 : 1 });
      await loadShoes();
      renderSettingsTab('shoes');
    });
  });
}

function buildPhasesTab() {
  const colorOptions = [
    { v: '#3B82F6', l: '青' }, { v: '#10B981', l: '緑' }, { v: '#F59E0B', l: '黄' },
    { v: '#EF4444', l: '赤' }, { v: '#8B5CF6', l: '紫' }, { v: '#EC4899', l: 'ピンク' },
  ];
  const rows = S.phases.map(p => `
    <div class="list-item" data-phase-id="${p.id}">
      <span class="color-swatch" style="background:${p.color}"></span>
      <div class="list-item-label">
        <div>${escHtml(p.name)}</div>
        <div class="list-item-sub">${p.start_date} ～ ${p.end_date || '進行中'} ${p.notes ? '/ ' + escHtml(p.notes) : ''}</div>
      </div>
      <button class="btn btn-sm btn-danger" data-phase-del="${p.id}">削除</button>
    </div>
  `).join('');
  const colorOpts = colorOptions.map(c => `<option value="${c.v}">${c.l}</option>`).join('');
  return `
    <div class="settings-section">
      <h3>フェーズ一覧</h3>
      <div id="phases-list">${rows || '<p style="color:var(--text-muted)">登録なし</p>'}</div>
      <hr style="margin:16px 0;border:none;border-top:1px solid var(--border)">
      <h3>フェーズ追加</h3>
      <div class="form-group"><label>フェーズ名</label><input id="new-phase-name" placeholder="例: 基礎期"></div>
      <div class="form-group"><label>開始日</label><input type="date" id="new-phase-start"></div>
      <div class="form-group"><label>終了日（空欄=進行中）</label><input type="date" id="new-phase-end"></div>
      <div class="form-group"><label>カラー</label><select id="new-phase-color">${colorOpts}</select></div>
      <div class="form-group"><label>メモ</label><input id="new-phase-notes" placeholder="目標・方針など"></div>
      <button class="btn btn-primary" id="btn-add-phase">追加</button>
    </div>
  `;
}

function initPhasesTabEvents() {
  document.getElementById('btn-add-phase')?.addEventListener('click', async () => {
    const name = document.getElementById('new-phase-name').value.trim();
    const start_date = document.getElementById('new-phase-start').value;
    if (!name || !start_date) { toast('フェーズ名と開始日は必須です', 'error'); return; }
    await api.post('/api/phases', {
      name, start_date,
      end_date: document.getElementById('new-phase-end').value || null,
      color: document.getElementById('new-phase-color').value,
      notes: document.getElementById('new-phase-notes').value,
    });
    await loadPhases();
    renderSettingsTab('phases');
    toast('フェーズを追加しました', 'success');
  });

  document.querySelectorAll('[data-phase-del]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('このフェーズを削除しますか？関連するセッションのフェーズ割り当てが外れます。')) return;
      await api.del('/api/phases/' + btn.dataset.phaseDel);
      await loadPhases();
      renderSettingsTab('phases');
      await loadSessions(); renderTbody();
      toast('フェーズを削除しました');
    });
  });
}

function buildColumnsTab() {
  return `
    <div class="settings-section">
      <h3>列表示設定</h3>
      <p style="font-size:12px;color:var(--text-muted)">
        バイオメカニクス列（GC/VO/Stride/GCB）は常時表示です。<br>
        Phase 3のSuunto API連携後に自動入力されます。
      </p>
    </div>
  `;
}

function buildDataTab() {
  return `
    <div class="settings-section">
      <h3>データエクスポート</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" onclick="exportTSV('all')">TSV 全件</button>
        <button class="btn" onclick="exportTSV('month')">TSV 今月</button>
        <button class="btn" onclick="openMdModal([])">Markdown 今月</button>
      </div>
    </div>
    <div class="settings-section">
      <h3>データ管理</h3>
      <p style="font-size:12px;color:var(--text-muted);margin-bottom:8px">データは <code>data/tracker.db</code> に保存されています。</p>
      <button class="btn btn-danger" id="btn-reset-seed">⚠️ ダミーデータを再シード（開発用）</button>
    </div>
  `;
}

/* ===== Export ===== */
function exportTSV(scope, ids) {
  let url = `/api/export/tsv?scope=${scope}`;
  if (scope === 'month') url += `&month=${S.currentMonth}`;
  if (scope === 'selected' && ids) url += `&ids=${ids.join(',')}`;
  window.open(url, '_blank');
}

async function openMdModal(ids) {
  const idsParam = ids && ids.length ? ids.join(',') : '';
  const prompt = document.getElementById('md-prompt-select')?.value || '';
  const url = `/api/export/markdown?${idsParam ? 'ids=' + idsParam : 'ids=' + S.sessions.map(s => s.id).join(',')}&prompt=${encodeURIComponent(prompt)}`;
  const data = await api.get(url);
  document.getElementById('md-modal').style.display = 'block';
  document.getElementById('md-preview').value = data.markdown;
}

/* ===== Add Session ===== */
function openAddSession() {
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('new-date').value = today;
  document.getElementById('add-session-modal').style.display = 'block';
}
function closeAddSession() { document.getElementById('add-session-modal').style.display = 'none'; }

async function confirmAddSession() {
  const date = document.getElementById('new-date').value;
  const activity_type = document.querySelector('input[name="new-type"]:checked').value;
  if (!date) { toast('日付を入力してください', 'error'); return; }
  try {
    const session = await api.post('/api/sessions', { date, activity_type });
    // Refresh months and sessions
    S.months = await api.get('/api/sessions/months');
    if (!S.months.includes(S.currentMonth) || session.date.startsWith(S.currentMonth)) {
      if (!S.months.includes(session.date.slice(0, 7))) {
        S.currentMonth = session.date.slice(0, 7);
      }
      await loadSessions();
      renderTbody();
      renderMonthNav();
    }
    closeAddSession();
    toast('セッションを追加しました', 'success');
  } catch(e) { toast('追加エラー: ' + e.message, 'error'); }
}

/* ===== Helper ===== */
function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escAttr(s) {
  return String(s || '').replace(/"/g,'&quot;');
}

/* ===== Events ===== */
function initEvents() {
  // Month navigation
  document.getElementById('btn-prev-month').addEventListener('click', async () => {
    const idx = S.months.indexOf(S.currentMonth);
    if (idx > 0) {
      S.currentMonth = S.months[idx - 1];
      S.selectedIds.clear();
      await loadSessions();
      renderTable();
      renderMonthNav();
    }
  });
  document.getElementById('btn-next-month').addEventListener('click', async () => {
    const idx = S.months.indexOf(S.currentMonth);
    if (idx < S.months.length - 1) {
      S.currentMonth = S.months[idx + 1];
      S.selectedIds.clear();
      await loadSessions();
      renderTable();
      renderMonthNav();
    }
  });

  // Month label click → show native date picker for quick jump
  document.getElementById('month-label').addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'month';
    input.value = S.currentMonth;
    input.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.appendChild(input);
    input.addEventListener('change', async () => {
      const ym = input.value;
      if (ym) {
        if (!S.months.includes(ym)) {
          toast('その月のデータがありません', 'error');
        } else {
          S.currentMonth = ym;
          S.selectedIds.clear();
          await loadSessions();
          renderTable();
          renderMonthNav();
        }
      }
      input.remove();
    });
    input.click();
  });

  // Type filter toggles
  document.querySelectorAll('.type-toggle').forEach(label => {
    label.addEventListener('click', (e) => {
      const cb = label.querySelector('input');
      const type = label.dataset.type;
      cb.checked = !cb.checked;
      S.filters.types[type] = cb.checked;
      label.classList.toggle('active', cb.checked);
      renderTbody();
      e.preventDefault();
    });
  });

  // Text search
  const searchInput = document.getElementById('search-input');
  searchInput.addEventListener('input', () => {
    S.filters.text = searchInput.value;
    document.getElementById('btn-clear-search').style.display = S.filters.text ? 'inline-block' : 'none';
    renderTbody();
  });
  document.getElementById('btn-clear-search').addEventListener('click', () => {
    searchInput.value = '';
    S.filters.text = '';
    document.getElementById('btn-clear-search').style.display = 'none';
    renderTbody();
  });

  // Select all
  document.getElementById('select-all').addEventListener('change', (e) => {
    const sessions = getFilteredSessions();
    if (e.target.checked) sessions.forEach(s => S.selectedIds.add(s.id));
    else S.selectedIds.clear();
    document.querySelectorAll('.row-cb').forEach(cb => {
      const id = cb.closest('tr')?.dataset.id;
      cb.checked = id ? S.selectedIds.has(id) : false;
      cb.closest('tr')?.classList.toggle('row-selected', cb.checked);
    });
    renderStatusBar();
  });

  // Sort headers
  document.getElementById('session-thead').addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort]');
    if (!th) return;
    const col = th.dataset.sort;
    if (S.sort.col === col) S.sort.dir = S.sort.dir === 'asc' ? 'desc' : 'asc';
    else { S.sort.col = col; S.sort.dir = 'asc'; }
    renderTable();
  });

  // Table body delegation
  document.getElementById('session-tbody').addEventListener('click', (e) => {
    // Checkbox
    const cb = e.target.closest('.row-cb');
    if (cb) {
      const tr = cb.closest('tr');
      const id = tr?.dataset.id;
      if (!id) return;
      if (cb.checked) S.selectedIds.add(id);
      else S.selectedIds.delete(id);
      tr.classList.toggle('row-selected', cb.checked);
      renderStatusBar();
      document.getElementById('select-all').indeterminate = S.selectedIds.size > 0 && S.selectedIds.size < getFilteredSessions().length;
      document.getElementById('select-all').checked = S.selectedIds.size === getFilteredSessions().length;
      return;
    }
    // AI eval buttons
    const aiBtn = e.target.closest('[data-action^="eval-"]');
    if (aiBtn) {
      const provider = aiBtn.dataset.action.replace('eval-', '');
      evaluateSession(aiBtn.dataset.id, provider);
      return;
    }
    // Delete button
    const delBtn = e.target.closest('[data-action="delete"]');
    if (delBtn) {
      deleteSession(delBtn.dataset.id);
      return;
    }
    // Editable cell
    const td = e.target.closest('td[data-field]');
    if (td) {
      startCellEdit(td, td.dataset.id, td.dataset.field);
      return;
    }
  });

  // Bulk AI
  document.getElementById('btn-bulk-claude').addEventListener('click', () => bulkEvaluate('claude'));
  document.getElementById('btn-bulk-gpt').addEventListener('click', () => bulkEvaluate('gpt'));

  // Export dropdown
  document.getElementById('btn-export').addEventListener('click', (e) => {
    const menu = document.getElementById('export-menu');
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
    e.stopPropagation();
  });
  document.getElementById('export-menu').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    document.getElementById('export-menu').style.display = 'none';
    const action = btn.dataset.action;
    if (action === 'tsv-month') exportTSV('month');
    else if (action === 'tsv-all') exportTSV('all');
    else if (action === 'tsv-selected') exportTSV('selected', [...S.selectedIds]);
    else if (action === 'md-selected') openMdModal([...S.selectedIds]);
    else if (action === 'md-all') openMdModal(S.sessions.map(s => s.id));
  });


  // Detail panel
  document.getElementById('btn-close-panel').addEventListener('click', closeDetailPanel);
  document.getElementById('panel-overlay').addEventListener('click', closeDetailPanel);

  // Settings
  document.getElementById('btn-settings').addEventListener('click', () => openSettings('api'));
  document.getElementById('btn-close-settings').addEventListener('click', closeSettings);
  document.getElementById('settings-modal').addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-backdrop')) closeSettings();
  });


  // Add session
  document.getElementById('btn-add-session').addEventListener('click', openAddSession);
  document.getElementById('btn-close-add').addEventListener('click', closeAddSession);
  document.getElementById('btn-cancel-add').addEventListener('click', closeAddSession);
  document.getElementById('btn-confirm-add').addEventListener('click', confirmAddSession);
  document.getElementById('add-session-modal').addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-backdrop')) closeAddSession();
  });

  // Markdown modal
  document.getElementById('btn-close-md').addEventListener('click', () => {
    document.getElementById('md-modal').style.display = 'none';
  });
  document.getElementById('md-modal').addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-backdrop')) document.getElementById('md-modal').style.display = 'none';
  });
  document.getElementById('md-prompt-select')?.addEventListener('change', async () => {
    const preview = document.getElementById('md-preview');
    if (!preview) return;
    const prompt = document.getElementById('md-prompt-select').value;
    const ids = S.sessions.map(s => s.id).join(',');
    const data = await api.get(`/api/export/markdown?ids=${ids}&prompt=${encodeURIComponent(prompt)}`);
    preview.value = data.markdown;
  });
  document.getElementById('btn-copy-md').addEventListener('click', async () => {
    const text = document.getElementById('md-preview').value;
    await navigator.clipboard.writeText(text);
    const msg = document.getElementById('md-copy-msg');
    msg.style.display = 'inline';
    setTimeout(() => { msg.style.display = 'none'; }, 2000);
  });

  // Close dropdowns on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.export-dropdown')) {
      document.getElementById('export-menu').style.display = 'none';
    }
    if (!e.target.closest('#autocomplete-list') && !e.target.closest('.cell-editing')) {
      hideAutocomplete();
    }
  });
}

/* ===== Boot ===== */
init().catch(console.error);
