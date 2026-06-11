const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const lapsStore = require('../laps-store');
const { parseSession } = require('../lib/suunto-parser');
const { parsePlanTsv } = require('../lib/plan-tsv-parser');
const { getSession, SESSION_TYPE_TO_SECTION } = require('../db/slot-view');

const RAW_DIR = path.join(__dirname, '../../data/suunto_raw');
const PLANS_DIR = path.join(__dirname, '../../data/plans');

function getPhaseId(date) {
  const p = db.prepare(
    "SELECT id FROM phases WHERE start_date <= ? AND (end_date IS NULL OR end_date >= ?) ORDER BY start_date DESC LIMIT 1"
  ).get(date, date);
  return p ? p.id : null;
}

function isDuplicate(s) {
  return !!db.prepare(
    `SELECT 1 FROM results r JOIN slots sl ON sl.id = r.slot_id
     WHERE sl.date = ? AND r.distance_km = ? AND r.duration_s = ?`
  ).get(s.date, s.distance_km, s.duration_s);
}

// Phase 1.5: パーサー出力（旧sessions形状）を slot + result に分解して投入
// ※ 取り込みは実績ベースのため status='done'（予定外unplanned等の意味論はPhase 2で導入）
function insertParsed(session, laps, filename, now) {
  const slotId = uuidv4();
  const section = SESSION_TYPE_TO_SECTION[session.session_type] ?? null;

  db.prepare(`INSERT INTO slots
    (id, date, section, slot_type, status, plan_menu, plan_notes, plan_locate, plan_shoes,
     actual_menu, memo, impression, phase_id, source, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(slotId, session.date, section, 'run', 'done',
      session.menu || null, null, session.locate || null, session.shoes || null,
      session.menu || null, session.memo || null, null,
      getPhaseId(session.date), 'manual', now, now);

  db.prepare(`INSERT INTO results
    (id, slot_id, suunto_workout_id, raw_json_path, start_time, distance_km, duration_s, pace_per_km_s,
     avg_hr_bpm, elevation_m, energy_kcal, title, trimp, vo2max, ground_contact_ms, gcb_left_pct,
     vertical_oscillation_cm, cadence_avg_spm, cadence_max_spm, stride_length_cm, source, imported_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(uuidv4(), slotId,
      session.suunto_workout_id || null,
      filename ? 'data/suunto_raw/' + filename : null,
      null,
      session.distance_km, session.duration_s, session.pace_per_km_s,
      session.avg_hr_pct != null ? Math.round(session.avg_hr_pct) : null, // パーサーはbpm格納
      session.elevation_m, session.energy_kcal, session.title, session.trimp, session.vo2max,
      session.ground_contact_ms, session.gcb_left_pct, session.vertical_oscillation_cm,
      session.cadence_avg_spm, session.cadence_max_spm, session.stride_length_cm,
      'suunto_json', now);

  // ラップはDBに保存せずメモリストアへ（slot idをキーにする）
  if (laps && laps.length) lapsStore.setLaps(slotId, laps);

  return slotId;
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

      const id = insertParsed(session, laps, filename, now);

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

  const now = new Date().toISOString();
  const results = [];

  db.transaction(() => {
    for (const { filename, session, laps, content } of sessions) {
      if (isDuplicate(session)) {
        results.push({ filename, status: 'skipped', reason: 'duplicate' });
        continue;
      }

      // 生JSON＝真実の源：先に原本を保管してからDBへ（v5 3.1）
      if (content && filename) {
        try {
          fs.writeFileSync(path.join(RAW_DIR, filename), JSON.stringify(content), 'utf8');
        } catch (_) {}
      }

      const id = insertParsed(session, laps, filename, now);

      results.push({ filename, status: 'inserted', id, session: getSession(id) });
    }
  })();

  res.json({ results });
});

// ============================================================
// 計画TSVインポート（docs/suunto_design_v5.md 5.2）
// 書き込みは slots への INSERT のみ。既存slotの UPDATE/DELETE はしない。
// ============================================================

// 取込対象期間の既存slot（日付別件数・status内訳）を返す
function findExistingSlots(slots) {
  const dates = [...new Set(slots.map(s => s.date))];
  const existing = [];
  for (const date of dates.sort()) {
    const rows = db.prepare('SELECT status FROM slots WHERE date = ?').all(date);
    if (rows.length === 0) continue;
    const byStatus = {};
    for (const r of rows) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    existing.push({ date, count: rows.length, byStatus });
  }
  return existing;
}

// POST /api/import/plan/preview
// Body: { tsv, year } → { ok, errors, warnings, summary, existing }（DB投入なし）
router.post('/plan/preview', (req, res) => {
  const { tsv, year } = req.body;
  if (typeof tsv !== 'string') return res.status(400).json({ error: 'tsv required' });

  const parsed = parsePlanTsv(tsv, Number(year));
  res.json({
    ok: parsed.ok,
    errors: parsed.errors,
    warnings: parsed.warnings,
    summary: parsed.summary,
    existing: parsed.ok ? findExistingSlots(parsed.slots) : [],
  });
});

// POST /api/import/plan/commit
// Body: { tsv, year }（プレビューと同一テキストを再パース→トランザクションで全件INSERT）
// → { ok, insertedIds, count, summary }。insertedIds は取り消し（undo）に使う
router.post('/plan/commit', (req, res) => {
  const { tsv, year } = req.body;
  if (typeof tsv !== 'string') return res.status(400).json({ error: 'tsv required' });

  const parsed = parsePlanTsv(tsv, Number(year));
  if (!parsed.ok) {
    return res.status(400).json({ ok: false, errors: parsed.errors });
  }

  // 原本保管（生データ＝真実の源。v5 3.1）
  fs.mkdirSync(PLANS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  fs.writeFileSync(path.join(PLANS_DIR, `plan_${stamp}.tsv`), tsv, 'utf8');

  const now = new Date().toISOString();
  const insertedIds = [];
  const insert = db.prepare(`INSERT INTO slots
    (id, date, section, slot_type, status, plan_menu, plan_notes, plan_locate, plan_shoes,
     actual_menu, memo, impression, phase_id, source, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

  db.transaction(() => {
    for (const s of parsed.slots) {
      const id = uuidv4();
      insert.run(id, s.date, s.section, s.slot_type, 'planned',
        s.plan_menu, s.plan_notes, s.plan_locate, s.plan_shoes,
        null, null, null, getPhaseId(s.date), 'tsv_import', now, now);
      insertedIds.push(id);
    }
  })();

  res.json({ ok: true, insertedIds, count: insertedIds.length, summary: parsed.summary });
});

// POST /api/import/plan/undo
// Body: { ids } → 直前の取込で挿入した slot のみ削除（status='planned' AND source='tsv_import' に限定）
router.post('/plan/undo', (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids required' });
  }

  const del = db.prepare(
    "DELETE FROM slots WHERE id = ? AND status = 'planned' AND source = 'tsv_import'"
  );
  let deleted = 0;
  db.transaction(() => {
    for (const id of ids) deleted += del.run(String(id)).changes;
  })();

  res.json({ ok: true, deleted });
});

module.exports = router;
