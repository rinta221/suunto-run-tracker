const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const lapsStore = require('../laps-store');
const { listSessions, getSession, SESSION_TYPE_TO_SECTION, ACTIVITY_TO_SLOT_TYPE } = require('../db/slot-view');

// Phase 1.5: 内部実装を slots LEFT JOIN results に切替（レスポンスのJSON形状は旧sessions互換）
// インライン編集の保存先振り分け（旧キー → slots列）。数値系はresult由来のため編集対象外
const SLOT_FIELD_MAP = {
  date: 'date',
  menu: 'actual_menu',
  memo: 'memo',
  locate: 'plan_locate',
  shoes: 'plan_shoes',
  impression: 'impression',
  planned_menu: 'plan_menu',
  phase_id: 'phase_id',
};

// AI評価系（旧キー → evaluations列）。ai別にUPSERTする
const EVAL_FIELD_MAP = {
  claude_eval: { ai: 'claude', col: 'text' },
  claude_eval_at: { ai: 'claude', col: 'created_at' },
  claude_eval_locked: { ai: 'claude', col: 'locked' },
  gpt_eval: { ai: 'gpt', col: 'text' },
  gpt_eval_at: { ai: 'gpt', col: 'created_at' },
  gpt_eval_locked: { ai: 'gpt', col: 'locked' },
};

function upsertEvalField(slotId, ai, col, value, now) {
  const existing = db.prepare('SELECT id FROM evaluations WHERE slot_id = ? AND ai = ?').get(slotId, ai);
  if (existing) {
    db.prepare(`UPDATE evaluations SET ${col} = ?, updated_at = ? WHERE id = ?`).run(value, now, existing.id);
  } else {
    db.prepare('INSERT INTO evaluations (id, slot_id, ai, text, locked, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
      .run(uuidv4(), slotId, ai,
        col === 'text' ? value : null,
        col === 'locked' ? (value ? 1 : 0) : 0,
        col === 'created_at' ? value : now,
        now);
  }
}

// GET /api/sessions/months
router.get('/months', (req, res) => {
  const rows = db.prepare(
    "SELECT DISTINCT substr(date,1,7) as month FROM slots ORDER BY month ASC"
  ).all();
  res.json(rows.map(r => r.month));
});

// GET /api/sessions/autocomplete/:field?q=
router.get('/autocomplete/:field', (req, res) => {
  const { field } = req.params;
  const { q } = req.query;
  const colMap = { menu: 'actual_menu', locate: 'plan_locate', shoes: 'plan_shoes' };
  const col = colMap[field];
  if (!col) return res.json([]);
  const stmt = q
    ? db.prepare(`SELECT DISTINCT ${col} as v FROM slots WHERE ${col} IS NOT NULL AND ${col} != '' AND ${col} LIKE ? ORDER BY ${col} LIMIT 20`)
    : db.prepare(`SELECT DISTINCT ${col} as v FROM slots WHERE ${col} IS NOT NULL AND ${col} != '' ORDER BY ${col} LIMIT 20`);
  const rows = q ? stmt.all('%' + q + '%') : stmt.all();
  res.json(rows.map(r => r.v));
});

// GET /api/sessions?month=YYYY-MM
router.get('/', (req, res) => {
  res.json(listSessions(req.query.month));
});

// POST /api/sessions
router.post('/', (req, res) => {
  const now = new Date().toISOString();
  const id = uuidv4();
  const date = req.body.date || now.slice(0, 10);

  const phase = db.prepare(
    "SELECT id FROM phases WHERE start_date <= ? AND (end_date IS NULL OR end_date >= ?) ORDER BY start_date DESC LIMIT 1"
  ).get(date, date);

  db.prepare(`INSERT INTO slots
    (id, date, section, slot_type, status, plan_menu, plan_notes, plan_locate, plan_shoes,
     actual_menu, memo, impression, phase_id, source, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(
      id, date,
      SESSION_TYPE_TO_SECTION[req.body.session_type] ?? null,
      ACTIVITY_TO_SLOT_TYPE[req.body.activity_type] ?? 'run',
      'done',
      req.body.menu || null, null,
      req.body.locate || null, req.body.shoes || null,
      req.body.menu || null, req.body.memo || null, null,
      phase ? phase.id : null, 'manual', now, now
    );

  res.status(201).json(getSession(id));
});

// PATCH /api/sessions/:id
router.patch('/:id', (req, res) => {
  const { id } = req.params;
  const now = new Date().toISOString();

  const slot = db.prepare('SELECT id FROM slots WHERE id = ?').get(id);
  if (!slot) return res.status(404).json({ error: 'not found' });

  const sets = [];
  const vals = [];
  let touchedEval = false;
  for (const [k, v] of Object.entries(req.body)) {
    if (SLOT_FIELD_MAP[k]) {
      sets.push(`${SLOT_FIELD_MAP[k]} = ?`);
      vals.push(v);
    } else if (k === 'activity_type') {
      sets.push('slot_type = ?');
      vals.push(ACTIVITY_TO_SLOT_TYPE[v] ?? 'run');
    } else if (EVAL_FIELD_MAP[k]) {
      const { ai, col } = EVAL_FIELD_MAP[k];
      upsertEvalField(id, ai, col, col === 'locked' ? (v ? 1 : 0) : v, now);
      touchedEval = true;
    }
    // 数値系（distance_km等）はresult由来のため無視（編集対象外）
  }

  if (sets.length > 0) {
    db.prepare(`UPDATE slots SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run([...vals, now, id]);
  } else if (touchedEval) {
    db.prepare('UPDATE slots SET updated_at = ? WHERE id = ?').run(now, id);
  }

  res.json(getSession(id));
});

// GET /api/sessions/:id/laps
// Returns lap data from in-memory store (NOT stored in DB per design spec)
// Lap-level biomechanics (GCT/VO/Stride/GCB) available when source is Suunto JSON export
router.get('/:id/laps', (req, res) => {
  const laps = lapsStore.getLaps(req.params.id);
  if (!laps) return res.json([]);
  const cleaned = laps.map(l => ({
    lap_number: l.lap_number,
    distance_km: l.distance_km,
    lap_duration_s: l.lap_duration_s,
    pace_s: l.pace_s,
    avg_hr_bpm: l.avg_hr_bpm != null ? Math.round(l.avg_hr_bpm) : null,
    max_hr_bpm: l.max_hr_bpm != null ? Math.round(l.max_hr_bpm) : null,
    ascent_m: l.ascent_m != null ? Math.round(l.ascent_m) : (l.elevation_gain_m != null ? Math.round(l.elevation_gain_m) : null),
    descent_m: l.descent_m != null ? Math.round(l.descent_m) : null,
    power_w: l.power_w != null ? Math.round(l.power_w * 10) / 10 : null,
    cadence_spm: l.cadence_spm,
    // Biomechanics — available from Suunto JSON export (not from FIT)
    ground_contact_ms: l.ground_contact_ms != null ? Math.round(l.ground_contact_ms) : null,
    vertical_oscillation_cm: l.vertical_oscillation_cm != null ? Math.round(l.vertical_oscillation_cm * 10) / 10 : null,
    stride_length_m: l.stride_length_m != null ? Math.round(l.stride_length_m * 1000) / 1000 : null,
    gcb_left_pct: l.gcb_left_pct != null ? Math.round(l.gcb_left_pct * 10) / 10 : null,
  }));
  res.json(cleaned);
});

// DELETE /api/sessions/:id
router.delete('/:id', (req, res) => {
  db.transaction(() => {
    db.prepare('DELETE FROM evaluations WHERE slot_id = ?').run(req.params.id);
    db.prepare('DELETE FROM results WHERE slot_id = ?').run(req.params.id);
    db.prepare('DELETE FROM slots WHERE id = ?').run(req.params.id);
  })();
  res.json({ ok: true });
});

module.exports = router;
