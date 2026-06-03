/**
 * import_spreadsheet.js
 * スプレッドシートデータ（data/spreadsheet_sessions.json）と
 * サンプルJSONデータ（data/sample_sessions.json）をDBにインポートする
 *
 * Usage:
 *   node server/scripts/import_spreadsheet.js          # 追加のみ（重複スキップ）
 *   node server/scripts/import_spreadsheet.js --clean  # ダミーデータ削除後にインポート
 *   node server/scripts/import_spreadsheet.js --dry-run # 実行せず件数確認のみ
 *
 * 重複チェック：date + distance_km が同じ行は上書きしない
 * （distance_km = null の場合は date + activity_type で重複チェック）
 *
 * 注意：duration_s / pace_per_km_s はスプレッドシートの変換誤りで
 * 一部セッションが60×の値になっている可能性があります。
 * このスクリプトでは変換せずそのまま取り込みます（手動修正推奨）。
 */

const path = require('path');
const fs = require('fs');
const db = require('../db/database');

// Laps store is NOT needed for import script (server manages laps in memory)
// But we note which sessions have laps for the report.

const args = process.argv.slice(2);
const CLEAN = args.includes('--clean');
const DRY_RUN = args.includes('--dry-run');

if (DRY_RUN) console.log('[DRY RUN] 変更は行いません\n');

// --- Phase / Shoe ensure ---
function ensurePhasesExist() {
  const count = db.prepare('SELECT COUNT(*) as n FROM phases').get().n;
  if (count === 0) {
    const now = new Date().toISOString();
    const { v4: uuidv4 } = require('uuid');
    const phases = [
      { id: uuidv4(), name: '基礎期', start_date: '2025-12-01', end_date: '2025-12-31', color: '#3B82F6', notes: '有酸素ベース構築', created_at: now },
      { id: uuidv4(), name: 'ビルドアップ期', start_date: '2026-01-01', end_date: '2026-04-30', color: '#10B981', notes: '閾値走・インターバル導入', created_at: now },
      { id: uuidv4(), name: 'ピーク期', start_date: '2026-05-01', end_date: '2026-05-31', color: '#F59E0B', notes: 'レースシミュレーション', created_at: now },
      { id: uuidv4(), name: '回復期', start_date: '2026-06-01', end_date: null, color: '#8B5CF6', notes: 'レース後回復', created_at: now },
    ];
    const ins = db.prepare('INSERT INTO phases (id, name, start_date, end_date, color, notes, created_at) VALUES (?,?,?,?,?,?,?)');
    for (const p of phases) ins.run(p.id, p.name, p.start_date, p.end_date, p.color, p.notes, p.created_at);
    console.log(`フェーズ ${phases.length} 件を作成しました`);
  }
}

function getPhaseId(date) {
  const p = db.prepare("SELECT id FROM phases WHERE start_date <= ? AND (end_date IS NULL OR end_date >= ?) ORDER BY start_date DESC LIMIT 1").get(date, date);
  return p ? p.id : null;
}

function isDuplicate(session) {
  if (session.distance_km != null) {
    return !!db.prepare('SELECT 1 FROM sessions WHERE date = ? AND distance_km = ?').get(session.date, session.distance_km);
  } else {
    return !!db.prepare('SELECT 1 FROM sessions WHERE date = ? AND distance_km IS NULL AND activity_type = ?').get(session.date, session.activity_type);
  }
}

const DB_COLS = [
  'id','activity_type','suunto_workout_id','phase_id','date','menu','memo','locate','shoes',
  'distance_km','duration_s','pace_per_km_s','avg_hr_pct','elevation_m','cadence_score','energy_kcal',
  'title','trimp','vo2max','ground_contact_ms','gcb_left_pct','vertical_oscillation_cm',
  'cadence_max_spm','cadence_avg_spm','stride_length_cm','gc_balance',
  'impression','claude_eval','claude_eval_at','gpt_eval','gpt_eval_at','created_at','updated_at',
];

function importSessions(sessions, source) {
  let inserted = 0, skipped = 0, withLaps = 0;
  const now = new Date().toISOString();

  const insertStmt = DRY_RUN
    ? null
    : db.prepare(`INSERT OR IGNORE INTO sessions (${DB_COLS.join(',')}) VALUES (${DB_COLS.map(() => '?').join(',')})`);

  const doInsert = db.transaction((rows) => {
    for (const row of rows) insertStmt.run(DB_COLS.map(c => row[c] ?? null));
  });

  const toInsert = [];
  for (const raw of sessions) {
    const { laps, max_hr_pct, max_hr_bpm, ...s } = raw;

    if (laps && laps.length > 0) withLaps++;

    if (isDuplicate(s)) {
      skipped++;
      continue;
    }

    s.phase_id = getPhaseId(s.date);
    if (!s.created_at) s.created_at = now;
    if (!s.updated_at) s.updated_at = now;

    toInsert.push(s);
    inserted++;
  }

  if (!DRY_RUN && toInsert.length > 0) doInsert(toInsert);

  console.log(`[${source}]`);
  console.log(`  挿入: ${inserted} 件`);
  console.log(`  スキップ（重複）: ${skipped} 件`);
  if (withLaps > 0) {
    console.log(`  ⚠️  ラップデータ ${withLaps} 件 → DBに保存しません（サーバー起動時にメモリへ）`);
  }
  return inserted;
}

// ===== MAIN =====
console.log('=== Suunto Run Tracker インポート ===\n');

// 1. フェーズが存在することを確認
if (!DRY_RUN) ensurePhasesExist();

// 2. --clean: ダミーセッションを削除
if (CLEAN) {
  if (!DRY_RUN) {
    const before = db.prepare('SELECT COUNT(*) as n FROM sessions').get().n;
    db.prepare("DELETE FROM sessions WHERE suunto_workout_id LIKE 'SWO-%'").run();
    const after = db.prepare('SELECT COUNT(*) as n FROM sessions').get().n;
    console.log(`[clean] ダミーセッション削除: ${before - after} 件\n`);
  } else {
    const dummyCount = db.prepare("SELECT COUNT(*) as n FROM sessions WHERE suunto_workout_id LIKE 'SWO-%'").get().n;
    console.log(`[clean DRY] ダミーセッション削除予定: ${dummyCount} 件\n`);
  }
}

// 3. スプレッドシートデータをインポート
const spreadsheetPath = path.join(__dirname, '../../data/spreadsheet_sessions.json');
if (fs.existsSync(spreadsheetPath)) {
  const sessions = JSON.parse(fs.readFileSync(spreadsheetPath, 'utf8'));
  console.log(`スプレッドシートデータ: ${sessions.length} 件`);
  const types = sessions.reduce((a, s) => { a[s.activity_type] = (a[s.activity_type] || 0) + 1; return a; }, {});
  console.log(`  内訳: ${Object.entries(types).map(([k,v]) => `${k}:${v}`).join(', ')}`);
  importSessions(sessions, 'spreadsheet_sessions.json');
} else {
  console.log('⚠️  data/spreadsheet_sessions.json が見つかりません');
}

console.log('');

// 4. サンプルJSONデータをインポート（100kmウルトラ）
const samplePath = path.join(__dirname, '../../data/sample_sessions.json');
if (fs.existsSync(samplePath)) {
  const sessions = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
  console.log(`サンプルJSONデータ: ${sessions.length} 件`);
  importSessions(sessions, 'sample_sessions.json');
} else {
  console.log('⚠️  data/sample_sessions.json が見つかりません');
}

// 5. 結果サマリー
const total = db.prepare('SELECT COUNT(*) as n FROM sessions').get().n;
const months = db.prepare("SELECT DISTINCT substr(date,1,7) as m FROM sessions ORDER BY m").all().map(r => r.m);
console.log(`\n=== 完了 ===`);
console.log(`DB総セッション数: ${total} 件`);
console.log(`月一覧: ${months.join(', ')}`);
console.log('\nサーバーを再起動してください: npm start');
