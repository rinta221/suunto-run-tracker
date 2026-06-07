const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const lapsStore = require('../laps-store');
const { parseSession } = require('../lib/suunto-parser');

const RAW_DIR = path.join(__dirname, '../../data/suunto_raw');

const DB_COLS = [
  'id','activity_type','source','session_type','suunto_workout_id','phase_id','date',
  'planned_menu','menu','memo','locate','shoes','distance_km','duration_s','pace_per_km_s',
  'avg_hr_pct','elevation_m','cadence_score','energy_kcal','title','trimp','vo2max',
  'ground_contact_ms','gcb_left_pct','vertical_oscillation_cm','cadence_max_spm',
  'cadence_avg_spm','stride_length_cm','gc_balance','impression',
  'claude_eval','claude_eval_at','claude_eval_locked','gpt_eval','gpt_eval_at','gpt_eval_locked',
  'created_at','updated_at',
];

function getPhaseId(date) {
  const p = db.prepare(
    "SELECT id FROM phases WHERE start_date <= ? AND (end_date IS NULL OR end_date >= ?) ORDER BY start_date DESC LIMIT 1"
  ).get(date, date);
  return p ? p.id : null;
}

function isDuplicate(s) {
  return !!db.prepare(
    'SELECT 1 FROM sessions WHERE date = ? AND distance_km = ? AND duration_s = ?'
  ).get(s.date, s.distance_km, s.duration_s);
}

// ============================================================
// POST /api/import/suunto
// data/suunto_raw/ の *.json を全スキャン → パース → DB投入
// レスポンス：{ read, inserted, skipped, results }
// ============================================================
router.post('/suunto', (req, res) => {
  if (!fs.existsSync(RAW_DIR)) {
    return res.status(404).json({ error: 'data/suunto_raw/ が見つかりません' });
  }

  const files = fs.readdirSync(RAW_DIR).filter(f => f.endsWith('.json'));
  if (files.length === 0) {
    return res.json({ read: 0, inserted: 0, skipped: 0, results: [] });
  }

  const insertStmt = db.prepare(
    `INSERT OR IGNORE INTO sessions (${DB_COLS.join(',')}) VALUES (${DB_COLS.map(() => '?').join(',')})`
  );

  const now = new Date().toISOString();
  const results = [];

  db.transaction(() => {
    for (const filename of files) {
      let raw;
      try {
        raw = JSON.parse(fs.readFileSync(path.join(RAW_DIR, filename), 'utf8'));
      } catch (e) {
        results.push({ filename, status: 'error', error: 'JSONパースエラー: ' + e.message });
        continue;
      }

      let session, laps;
      try {
        ({ session, laps } = parseSession(raw, filename));
      } catch (e) {
        results.push({ filename, status: 'error', error: 'パーサーエラー: ' + e.message });
        continue;
      }

      if (isDuplicate(session)) {
        results.push({ filename, status: 'skipped', reason: 'duplicate' });
        continue;
      }

      const id = uuidv4();
      const row = {
        ...session,
        id,
        phase_id: getPhaseId(session.date),
        created_at: now,
        updated_at: now,
      };

      insertStmt.run(DB_COLS.map(c => row[c] ?? null));

      // ラップはDBに保存せずメモリストアへ（サーバー再起動時は seed.js で再ロード）
      if (laps && laps.length) lapsStore.setLaps(id, laps);

      results.push({
        filename,
        status: 'inserted',
        id,
        session_type: session.session_type,
        date: session.date,
        distance_km: session.distance_km,
        duration_s: session.duration_s,
        pace_per_km_s: session.pace_per_km_s,
        avg_hr_pct: session.avg_hr_pct,
        cadence_avg_spm: session.cadence_avg_spm,
        cadence_max_spm: session.cadence_max_spm,
        stride_length_cm: session.stride_length_cm,
        vertical_oscillation_cm: session.vertical_oscillation_cm,
        ground_contact_ms: session.ground_contact_ms,
        gcb_left_pct: session.gcb_left_pct,
        gc_balance: session.gc_balance,
        elevation_m: session.elevation_m,
        energy_kcal: session.energy_kcal,
        vo2max: session.vo2max,
        laps: laps.length,
      });
    }
  })();

  const inserted = results.filter(r => r.status === 'inserted').length;
  const skipped  = results.filter(r => r.status === 'skipped').length;

  res.json({ read: files.length, inserted, skipped, results });
});

// ============================================================
// POST /api/import/suunto/preview
// Body: { files: [{ filename, content }] }
// アップロードされた生JSONをパースしてプレビュー返却（DB投入なし）
// ============================================================
router.post('/suunto/preview', (req, res) => {
  const { files } = req.body;
  if (!Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: 'files required' });
  }

  const results = [];
  for (const { filename, content } of files) {
    try {
      const { session, laps } = parseSession(content, filename);
      const duplicate = isDuplicate(session);
      results.push({ filename, session, laps, duplicate });
    } catch (e) {
      results.push({ filename, error: e.message });
    }
  }

  res.json(results);
});

// ============================================================
// POST /api/import/suunto/commit
// Body: { sessions: [{ filename, session, laps, content }] }
// プレビュー承認後にDB投入
// ============================================================
router.post('/suunto/commit', (req, res) => {
  const { sessions } = req.body;
  if (!Array.isArray(sessions) || sessions.length === 0) {
    return res.status(400).json({ error: 'sessions required' });
  }

  if (!fs.existsSync(RAW_DIR)) fs.mkdirSync(RAW_DIR, { recursive: true });

  const insertStmt = db.prepare(
    `INSERT OR IGNORE INTO sessions (${DB_COLS.join(',')}) VALUES (${DB_COLS.map(() => '?').join(',')})`
  );

  const now = new Date().toISOString();
  const results = [];

  db.transaction(() => {
    for (const { filename, session, laps, content } of sessions) {
      if (isDuplicate(session)) {
        results.push({ filename, status: 'skipped', reason: 'duplicate' });
        continue;
      }

      const id = uuidv4();
      const row = { ...session, id, phase_id: getPhaseId(session.date), created_at: now, updated_at: now };

      insertStmt.run(DB_COLS.map(c => row[c] ?? null));

      if (laps && laps.length) lapsStore.setLaps(id, laps);

      if (content && filename) {
        try {
          fs.writeFileSync(path.join(RAW_DIR, filename), JSON.stringify(content), 'utf8');
        } catch (_) {}
      }

      results.push({ filename, status: 'inserted', id, session: row });
    }
  })();

  res.json({ results });
});

module.exports = router;
