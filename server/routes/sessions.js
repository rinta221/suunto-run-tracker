const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const lapsStore = require('../laps-store');

const EDITABLE_COLS = [
  'activity_type','date','menu','memo','locate','shoes',
  'distance_km','duration_s','pace_per_km_s','avg_hr_pct','elevation_m',
  'cadence_score','energy_kcal','title','trimp','vo2max',
  'ground_contact_ms','gcb_left_pct','vertical_oscillation_cm',
  'cadence_max_spm','cadence_avg_spm','stride_length_cm','gc_balance',
  'impression','claude_eval','claude_eval_at','gpt_eval','gpt_eval_at','phase_id',
];

// GET /api/sessions/months
router.get('/months', (req, res) => {
  const rows = db.prepare(
    "SELECT DISTINCT substr(date,1,7) as month FROM sessions ORDER BY month ASC"
  ).all();
  res.json(rows.map(r => r.month));
});

// GET /api/sessions/autocomplete/:field?q=
router.get('/autocomplete/:field', (req, res) => {
  const { field } = req.params;
  const { q } = req.query;
  if (!['menu', 'locate', 'shoes'].includes(field)) return res.json([]);
  const stmt = q
    ? db.prepare(`SELECT DISTINCT ${field} as v FROM sessions WHERE ${field} IS NOT NULL AND ${field} != '' AND ${field} LIKE ? ORDER BY ${field} LIMIT 20`)
    : db.prepare(`SELECT DISTINCT ${field} as v FROM sessions WHERE ${field} IS NOT NULL AND ${field} != '' ORDER BY ${field} LIMIT 20`);
  const rows = q ? stmt.all('%' + q + '%') : stmt.all();
  res.json(rows.map(r => r.v));
});

// GET /api/sessions?month=YYYY-MM
router.get('/', (req, res) => {
  const { month } = req.query;
  const stmt = month
    ? db.prepare(`
        SELECT s.*, p.name as phase_name, p.color as phase_color
        FROM sessions s LEFT JOIN phases p ON s.phase_id = p.id
        WHERE s.date LIKE ? ORDER BY s.date ASC, s.created_at ASC
      `)
    : db.prepare(`
        SELECT s.*, p.name as phase_name, p.color as phase_color
        FROM sessions s LEFT JOIN phases p ON s.phase_id = p.id
        ORDER BY s.date ASC, s.created_at ASC
      `);
  const sessions = month ? stmt.all(month + '-%') : stmt.all();
  res.json(sessions);
});

// POST /api/sessions
router.post('/', (req, res) => {
  const now = new Date().toISOString();
  const id = uuidv4();
  const date = req.body.date || now.slice(0, 10);

  const phase = db.prepare(
    "SELECT id FROM phases WHERE start_date <= ? AND (end_date IS NULL OR end_date >= ?) ORDER BY start_date DESC LIMIT 1"
  ).get(date, date);

  const s = {
    id,
    activity_type: req.body.activity_type || 'running',
    suunto_workout_id: null,
    phase_id: phase ? phase.id : null,
    date,
    menu: req.body.menu || null,
    memo: req.body.memo || null,
    locate: req.body.locate || null,
    shoes: req.body.shoes || null,
    distance_km: req.body.distance_km || null,
    duration_s: req.body.duration_s || null,
    pace_per_km_s: null,
    avg_hr_pct: null,
    elevation_m: null,
    cadence_score: null,
    energy_kcal: null,
    title: null,
    trimp: null,
    vo2max: null,
    ground_contact_ms: null,
    gcb_left_pct: null,
    vertical_oscillation_cm: null,
    cadence_max_spm: null,
    cadence_avg_spm: null,
    stride_length_cm: null,
    gc_balance: null,
    impression: null,
    claude_eval: null,
    claude_eval_at: null,
    gpt_eval: null,
    gpt_eval_at: null,
    created_at: now,
    updated_at: now,
  };

  const cols = Object.keys(s);
  db.prepare(`INSERT INTO sessions (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(Object.values(s));
  res.status(201).json(s);
});

// PATCH /api/sessions/:id
router.patch('/:id', (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  const now = new Date().toISOString();

  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(updates)) {
    if (EDITABLE_COLS.includes(k)) {
      sets.push(`${k} = ?`);
      vals.push(v);
    }
  }
  if (sets.length === 0) {
    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
    return res.json(row);
  }

  db.prepare(`UPDATE sessions SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run([...vals, now, id]);
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  res.json(row);
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
    avg_hr_pct: l.avg_hr_pct,
    max_hr_pct: l.max_hr_pct,
    elevation_gain_m: l.elevation_gain_m,
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
  db.prepare('DELETE FROM sessions WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
