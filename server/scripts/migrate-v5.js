/**
 * Phase 1.5 移行スクリプト：sessions → slots / results / evaluations 分解コピー
 * 設計書：docs/suunto_design_v5.md 3.2（DDL）・3.5（設計原則）・5.3（マッピング）・8章（手順）
 *
 * 原則：
 * - sessions は読むだけ（一切変更しない）
 * - 再実行可能（slots / results / evaluations を DELETE してから再投入）
 * - 過去データの特殊事情（%HR換算・gc_balance表記揺れ）はこのスクリプトに隔離（3.5）
 *
 * 実行：npm run migrate-v5
 */
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');

const RAW_DIR = path.join(__dirname, '../../data/suunto_raw');
const MAX_HR = 200; // %HRmax → bpm 推定換算用（移行データはモック扱い。Phase 4でAPI実測に置換）

const SECTION_MAP = { warmup: 'wu', main: 'main', cooldown: 'cd' };
const SLOT_TYPE_MAP = { running: 'run', rest: 'rest', manual: 'run' };

const log = (...a) => console.log(...a);
let hasError = false;
const fail = (msg) => { hasError = true; console.error('✗ ' + msg); };
const ok = (msg) => log('✓ ' + msg);

// ---------------------------------------------------------------
// 事前検査1：gcb_left_pct vs gc_balance の照合
// gcb_left_pct は gc_balance（"50.5% - 49.5%"形式の原文字列）のパース結果。
// 両方非NULLの行で値が一致するか確認し、gc_balanceのみの行は左値をレスキューパースする。
// ---------------------------------------------------------------
function parseGcBalanceLeft(text) {
  if (!text) return null;
  const left = String(text).split('-')[0];
  const m = left.match(/([0-9]+(?:[.,][0-9]+)?)/);
  if (!m) return null;
  return parseFloat(m[1].replace(',', '.'));
}

function inspectGcb() {
  log('\n== 事前検査1：gcb_left_pct vs gc_balance 照合 ==');
  const rows = db.prepare('SELECT date, gcb_left_pct, gc_balance FROM sessions').all();
  const both = rows.filter(r => r.gcb_left_pct != null && r.gc_balance);
  const onlyPct = rows.filter(r => r.gcb_left_pct != null && !r.gc_balance);
  const onlyBal = rows.filter(r => r.gcb_left_pct == null && r.gc_balance);
  log(`gcb_left_pct非NULL: ${both.length + onlyPct.length}件 / gc_balance非NULL: ${both.length + onlyBal.length}件 / 両方非NULL: ${both.length}件`);

  const mismatch = both.filter(r => {
    const parsed = parseGcBalanceLeft(r.gc_balance);
    return parsed == null || Math.abs(parsed - r.gcb_left_pct) > 0.05;
  });
  log(`両方非NULL行の照合不一致: ${mismatch.length}件` + (mismatch.length ? ' ' + JSON.stringify(mismatch) : ''));

  const rescued = [];
  const unrescued = [];
  for (const r of onlyBal) {
    const v = parseGcBalanceLeft(r.gc_balance);
    if (v != null) rescued.push({ date: r.date, gc_balance: r.gc_balance, parsed: v });
    else unrescued.push({ date: r.date, gc_balance: r.gc_balance });
  }
  log(`gc_balanceのみの行（gcb_left_pct NULL）: ${onlyBal.length}件 → 左値レスキューパース成功 ${rescued.length}件`);
  for (const r of rescued) log(`  ${r.date}  "${r.gc_balance}" → ${r.parsed}`);
  for (const r of unrescued) log(`  ${r.date}  "${r.gc_balance}" → パース不能（NULLのまま）`);
  return { rescued: new Map(rescued.map(r => [r.date + '|' + r.gc_balance, r.parsed])) };
}

// ---------------------------------------------------------------
// 事前検査2：avg_hr_pct の値域検査
// source='suunto' の行はパーサー仕様により bpm 格納（suunto-parser.js「列名はpctだがbpmで格納」）
// → 換算せずそのまま採用（指示書2.4「bpm相当の値が既にあればそのまま」）。
// 換算対象（source≠'suunto'＝スプレッドシート由来）に 120以上が混ざる場合は停止。
// ---------------------------------------------------------------
function inspectHr() {
  log('\n== 事前検査2：avg_hr_pct 値域検査 ==');
  // suunto / manual はともに bpm 格納。spreadsheet のみ %HRmax 格納で換算が必要。
  const bpmSrc = db.prepare("SELECT MIN(avg_hr_pct) mn, MAX(avg_hr_pct) mx, COUNT(avg_hr_pct) n FROM sessions WHERE source IN ('suunto','manual')").get();
  const sheet = db.prepare("SELECT MIN(avg_hr_pct) mn, MAX(avg_hr_pct) mx, COUNT(avg_hr_pct) n FROM sessions WHERE source NOT IN ('suunto','manual')").get();
  log(`source=suunto/manual（bpm格納・換算なし）: ${bpmSrc.n}件  値域 ${bpmSrc.mn}〜${bpmSrc.mx}`);
  log(`source=spreadsheet等（%HRmax・×${MAX_HR}/100換算）: ${sheet.n}件  値域 ${sheet.mn}〜${sheet.mx}`);

  if (sheet.n > 0 && sheet.mx >= 120) {
    const bad = db.prepare("SELECT date, source, avg_hr_pct FROM sessions WHERE source NOT IN ('suunto','manual') AND avg_hr_pct >= 120").all();
    fail('換算対象行に120以上の値が混在（bpm誤格納の疑い）。換算せず停止します: ' + JSON.stringify(bad));
    process.exit(1);
  }
  const outliers = db.prepare("SELECT date, avg_hr_pct, menu FROM sessions WHERE source NOT IN ('suunto','manual') AND avg_hr_pct IS NOT NULL AND (avg_hr_pct < 50 OR avg_hr_pct > 95)").all();
  if (outliers.length) {
    log(`50〜95の外側（120未満・換算は実施）: ${outliers.length}件`);
    for (const r of outliers) log(`  ${r.date}  ${r.avg_hr_pct}%（${r.menu || ''}）→ ${Math.round(r.avg_hr_pct * MAX_HR / 100)}bpm`);
  }
  ok('値域検査OK');
}

// ---------------------------------------------------------------
// raw_json_path の解決：source='suunto' の行のみ、date+section から
// data/suunto_raw/YYYYMMDD_{wu|main|cd}.json の実在を確認して設定
// ---------------------------------------------------------------
function resolveRawJsonPath(s, section) {
  if (s.source !== 'suunto' || !section) return null;
  const filename = s.date.replace(/-/g, '') + '_' + section + '.json';
  const rel = 'data/suunto_raw/' + filename;
  return fs.existsSync(path.join(RAW_DIR, filename)) ? rel : null;
}

// ---------------------------------------------------------------
// 移行本体
// ---------------------------------------------------------------
function migrate(gcbRescue) {
  log('\n== 移行実行 ==');
  const now = new Date().toISOString();
  const sessions = db.prepare('SELECT * FROM sessions ORDER BY date ASC, created_at ASC').all();

  const insertSlot = db.prepare(`INSERT INTO slots
    (id, date, section, slot_type, status, plan_menu, plan_notes, plan_locate, plan_shoes,
     actual_menu, memo, impression, phase_id, source, created_at, updated_at)
    VALUES (@id, @date, @section, @slot_type, @status, @plan_menu, @plan_notes, @plan_locate, @plan_shoes,
     @actual_menu, @memo, @impression, @phase_id, @source, @created_at, @updated_at)`);

  const insertResult = db.prepare(`INSERT INTO results
    (id, slot_id, suunto_workout_id, raw_json_path, start_time, distance_km, duration_s, pace_per_km_s,
     avg_hr_bpm, elevation_m, energy_kcal, title, trimp, vo2max, ground_contact_ms, gcb_left_pct,
     vertical_oscillation_cm, cadence_avg_spm, cadence_max_spm, stride_length_cm, source, imported_at)
    VALUES (@id, @slot_id, @suunto_workout_id, @raw_json_path, @start_time, @distance_km, @duration_s, @pace_per_km_s,
     @avg_hr_bpm, @elevation_m, @energy_kcal, @title, @trimp, @vo2max, @ground_contact_ms, @gcb_left_pct,
     @vertical_oscillation_cm, @cadence_avg_spm, @cadence_max_spm, @stride_length_cm, @source, @imported_at)`);

  const insertEval = db.prepare(`INSERT INTO evaluations
    (id, slot_id, ai, text, locked, created_at, updated_at)
    VALUES (@id, @slot_id, @ai, @text, @locked, @created_at, @updated_at)`);

  let rawPathCount = 0;
  let rawPathMissing = [];

  db.transaction(() => {
    // 再実行可能：新3テーブルを全削除してから再投入（sessionsは読むだけ）
    db.prepare('DELETE FROM evaluations').run();
    db.prepare('DELETE FROM results').run();
    db.prepare('DELETE FROM slots').run();

    for (const s of sessions) {
      const slotId = uuidv4();
      const section = s.session_type ? (SECTION_MAP[s.session_type] ?? null) : null;

      insertSlot.run({
        id: slotId,
        date: s.date,
        section,
        slot_type: SLOT_TYPE_MAP[s.activity_type] ?? 'run',
        status: 'done', // 5.3の確定判断：移行データは一律done
        plan_menu: (s.planned_menu && s.planned_menu !== '') ? s.planned_menu : s.menu,
        plan_notes: null, // 過去データに計画の狙いは存在しない
        plan_locate: s.locate,
        plan_shoes: s.shoes,
        actual_menu: s.menu, // 旧menuはplan/actual両方へ（5.3）
        memo: s.memo,
        impression: s.impression,
        phase_id: s.phase_id,
        source: 'manual', // 移行由来の出所はresults.source側で追跡
        created_at: s.created_at || now,
        updated_at: s.updated_at || now,
      });

      // result：running / manual の行に作る。
      // 例外（ユーザー確定 2026-06-11）：rest行でも距離を持つ3行（2026-01-13 / 04-01 / 04-13
      // 「ランオフ予定→実際は走った」）はresultを作りデータ無損失を優先する。
      // slot_type=restは維持（移行前後の表示同一性のため）。Phase 4のAPI補正時に
      // status=unplanned のrun slotへ正規化するか検討（既知の特殊データ）。
      const makesResult = s.activity_type === 'running' || s.activity_type === 'manual'
        || (s.activity_type === 'rest' && s.distance_km != null);
      if (makesResult) {
        // HR：suunto行は既にbpm格納→そのまま。スプレッドシート行は%HRmax→bpm推定換算
        let avgHrBpm = null;
        if (s.avg_hr_pct != null) {
          avgHrBpm = (s.source === 'suunto' || s.source === 'manual')
            ? Math.round(s.avg_hr_pct)
            : Math.round(s.avg_hr_pct * MAX_HR / 100);
        }

        // GCB：gcb_left_pct優先、NULLならgc_balance左値のレスキューパース値
        let gcb = s.gcb_left_pct;
        if (gcb == null && s.gc_balance) {
          gcb = gcbRescue.get(s.date + '|' + s.gc_balance) ?? null;
        }

        const rawPath = resolveRawJsonPath(s, section);
        if (s.source === 'suunto') {
          if (rawPath) rawPathCount++;
          else rawPathMissing.push(`${s.date} ${section || '(section不明)'}`);
        }

        insertResult.run({
          id: uuidv4(),
          slot_id: slotId,
          suunto_workout_id: (s.suunto_workout_id && s.suunto_workout_id !== '') ? s.suunto_workout_id : null,
          raw_json_path: rawPath,
          start_time: null, // 旧スキーマに無し
          distance_km: s.distance_km,
          duration_s: s.duration_s,
          pace_per_km_s: s.pace_per_km_s,
          avg_hr_bpm: avgHrBpm,
          elevation_m: s.elevation_m,
          energy_kcal: s.energy_kcal,
          title: s.title,
          trimp: s.trimp,
          vo2max: s.vo2max,
          ground_contact_ms: s.ground_contact_ms,
          gcb_left_pct: gcb,
          vertical_oscillation_cm: s.vertical_oscillation_cm,
          cadence_avg_spm: s.cadence_avg_spm,
          cadence_max_spm: s.cadence_max_spm,
          stride_length_cm: s.stride_length_cm,
          source: s.source === 'suunto' ? 'suunto_json' : 'spreadsheet',
          imported_at: now,
        });
      }

      // evaluations：claude / gpt をそれぞれ1行に分解
      if (s.claude_eval && s.claude_eval !== '') {
        insertEval.run({
          id: uuidv4(), slot_id: slotId, ai: 'claude', text: s.claude_eval,
          locked: s.claude_eval_locked ? 1 : 0,
          created_at: s.claude_eval_at, updated_at: s.claude_eval_at,
        });
      }
      if (s.gpt_eval && s.gpt_eval !== '') {
        insertEval.run({
          id: uuidv4(), slot_id: slotId, ai: 'gpt', text: s.gpt_eval,
          locked: 1, // 5.3の確定判断：gpt_eval移行時は無条件locked=1（172件保護）
          created_at: s.gpt_eval_at, updated_at: s.gpt_eval_at,
        });
      }
    }
  })();

  log(`raw_json_path 設定: ${rawPathCount}件`);
  if (rawPathMissing.length) log(`raw_json_path 不明（NULL・既知の制約）: ${rawPathMissing.join(' / ')}`);
}

// ---------------------------------------------------------------
// 検証（指示書ステップ3）
// ---------------------------------------------------------------
function verify() {
  log('\n== 検証 ==');
  const q = (sql) => Object.values(db.prepare(sql).get())[0];

  const sessionsAll = q('SELECT COUNT(*) FROM sessions');
  const slotsN = q('SELECT COUNT(*) FROM slots');
  (slotsN === sessionsAll ? ok : fail)(`slots件数 ${slotsN} = sessions全行数 ${sessionsAll}`);

  const runManualN = q("SELECT COUNT(*) FROM sessions WHERE activity_type IN ('running','manual')");
  const restWithDistN = q("SELECT COUNT(*) FROM sessions WHERE activity_type = 'rest' AND distance_km IS NOT NULL");
  const resultsN = q('SELECT COUNT(*) FROM results');
  (resultsN === runManualN + restWithDistN ? ok : fail)(
    `results件数 ${resultsN} = running/manual行数 ${runManualN} + 距離保持rest行数 ${restWithDistN}`);

  const evalSrcN = q("SELECT (SELECT COUNT(*) FROM sessions WHERE claude_eval IS NOT NULL AND claude_eval != '') + (SELECT COUNT(*) FROM sessions WHERE gpt_eval IS NOT NULL AND gpt_eval != '')");
  const evalsN = q('SELECT COUNT(*) FROM evaluations');
  (evalsN === evalSrcN ? ok : fail)(`evaluations件数 ${evalsN} = claude非空+gpt非空 ${evalSrcN}`);

  const gptSrcN = q("SELECT COUNT(*) FROM sessions WHERE gpt_eval IS NOT NULL AND gpt_eval != ''");
  const gptLockedN = q("SELECT COUNT(*) FROM evaluations WHERE ai='gpt' AND locked=1");
  (gptLockedN === gptSrcN ? ok : fail)(`gpt locked=1件数 ${gptLockedN} = gpt_eval非空件数 ${gptSrcN}`);

  const distOld = q('SELECT ROUND(COALESCE(SUM(distance_km),0), 3) FROM sessions');
  const distNew = q('SELECT ROUND(COALESCE(SUM(distance_km),0), 3) FROM results');
  if (Math.abs(distOld - distNew) < 1e-6) {
    ok(`距離合計 sessions ${distOld} = results ${distNew}`);
  } else {
    fail(`距離合計 sessions ${distOld} ≠ results ${distNew}（差分 ${(distOld - distNew).toFixed(3)}km）`);
    const cause = db.prepare("SELECT date, activity_type, distance_km, menu FROM sessions WHERE activity_type NOT IN ('running','manual') AND distance_km IS NOT NULL").all();
    log('  原因（resultを作らないrest行が距離を保持）:');
    for (const r of cause) log(`    ${r.date}  ${r.activity_type}  ${r.distance_km}km  「${r.menu || ''}」`);
  }

  // 日付スポットチェック
  const spot = (date) => db.prepare('SELECT section FROM slots WHERE date = ? ORDER BY section').all(date).map(r => r.section ?? '(null)');
  const s531 = spot('2026-05-31');
  (s531.length === 1 ? ok : fail)(`5/31 = ${s531.length} slots [${s531.join(', ')}]（期待: 1 slot = 100kmウルトラ1行）`);
  const s607 = spot('2026-06-07');
  const has3 = s607.length === 3 && ['cd', 'main', 'wu'].every(x => s607.includes(x));
  (has3 ? ok : fail)(`6/7 = ${s607.length} slots [${s607.join(', ')}]（期待: wu/main/cdの3 slots）`);
  const s606 = spot('2026-06-06');
  log(`  （参考）6/6 = ${s606.length} slots ※sessionsに6/6の行は存在しない`);
}

// ---------------------------------------------------------------
log('Phase 1.5 移行: sessions → slots / results / evaluations');
const { rescued } = inspectGcb();
inspectHr();
migrate(rescued);
verify();

if (hasError) {
  console.error('\n✗ 検証に不一致あり。原因を確認してください（フロント切替には進まない）');
  process.exit(1);
}
log('\n✓ 全検証パス');
