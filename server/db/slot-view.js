/**
 * Phase 1.5: slots/results/evaluations を旧sessions形状のJSONに変換する互換レイヤー
 * （docs/suunto_design_v5.md 8章ステップ3：レスポンス形状は互換維持でUI変更を最小化）
 *
 * - 1行 = 1 slot（LEFT JOIN results なので実績が無いslotも行になる。rest slotにresultが
 *   付く行もある＝距離保持rest行3件。「restにはresultが無い」前提を置かないこと）
 * - 旧avg_hr_pctキーには results.avg_hr_bpm（bpm値）を返す（UIの表示単位はbpmで一致）
 * - cadence_score / gc_balance はv5で廃止 → 常にnull
 */
const db = require('./database');

const SECTION_TO_SESSION_TYPE = { wu: 'warmup', main: 'main', cd: 'cooldown' };
const SESSION_TYPE_TO_SECTION = { warmup: 'wu', main: 'main', cooldown: 'cd' };
const ACTIVITY_TO_SLOT_TYPE = { running: 'run', rest: 'rest', manual: 'run' };

const BASE_SELECT = `
  SELECT sl.id, sl.date, sl.section, sl.slot_type, sl.status,
         sl.plan_menu, sl.plan_notes, sl.plan_locate, sl.plan_shoes,
         sl.actual_menu, sl.memo, sl.impression, sl.phase_id,
         sl.source AS slot_source, sl.created_at, sl.updated_at,
         r.suunto_workout_id, r.raw_json_path, r.distance_km, r.duration_s, r.pace_per_km_s,
         r.avg_hr_bpm, r.elevation_m, r.energy_kcal, r.title, r.trimp, r.vo2max,
         r.ground_contact_ms, r.gcb_left_pct, r.vertical_oscillation_cm,
         r.cadence_avg_spm, r.cadence_max_spm, r.stride_length_cm,
         r.source AS result_source,
         ec.text AS claude_eval, ec.created_at AS claude_eval_at, ec.locked AS claude_eval_locked,
         eg.text AS gpt_eval, eg.created_at AS gpt_eval_at, eg.locked AS gpt_eval_locked,
         p.name AS phase_name, p.color AS phase_color
  FROM slots sl
  LEFT JOIN results r ON r.slot_id = sl.id
  LEFT JOIN evaluations ec ON ec.slot_id = sl.id AND ec.ai = 'claude'
  LEFT JOIN evaluations eg ON eg.slot_id = sl.id AND eg.ai = 'gpt'
  LEFT JOIN phases p ON sl.phase_id = p.id
`;

function toLegacy(r) {
  if (!r) return null;
  return {
    id: r.id,
    activity_type: r.slot_type === 'rest' ? 'rest' : 'running',
    source: r.result_source === 'suunto_json' ? 'suunto' : r.slot_source,
    session_type: SECTION_TO_SESSION_TYPE[r.section] ?? null,
    suunto_workout_id: r.suunto_workout_id ?? null,
    phase_id: r.phase_id,
    date: r.date,
    planned_menu: r.plan_menu,
    menu: r.actual_menu,
    memo: r.memo,
    locate: r.plan_locate,
    shoes: r.plan_shoes,
    distance_km: r.distance_km ?? null,
    duration_s: r.duration_s ?? null,
    pace_per_km_s: r.pace_per_km_s ?? null,
    avg_hr_pct: r.avg_hr_bpm ?? null, // 旧キー名のままbpm値（UI表示単位はbpm）
    elevation_m: r.elevation_m ?? null,
    cadence_score: null,
    energy_kcal: r.energy_kcal ?? null,
    title: r.title ?? null,
    trimp: r.trimp ?? null,
    vo2max: r.vo2max ?? null,
    ground_contact_ms: r.ground_contact_ms ?? null,
    gcb_left_pct: r.gcb_left_pct ?? null,
    vertical_oscillation_cm: r.vertical_oscillation_cm ?? null,
    cadence_max_spm: r.cadence_max_spm ?? null,
    cadence_avg_spm: r.cadence_avg_spm ?? null,
    stride_length_cm: r.stride_length_cm ?? null,
    gc_balance: null,
    impression: r.impression,
    claude_eval: r.claude_eval ?? null,
    claude_eval_at: r.claude_eval_at ?? null,
    claude_eval_locked: r.claude_eval_locked ?? 0,
    gpt_eval: r.gpt_eval ?? null,
    gpt_eval_at: r.gpt_eval_at ?? null,
    gpt_eval_locked: r.gpt_eval_locked ?? 0,
    created_at: r.created_at,
    updated_at: r.updated_at,
    phase_name: r.phase_name ?? null,
    phase_color: r.phase_color ?? null,
    // v5の生情報（互換キーに追加）
    status: r.status,
    section: r.section,
    plan_notes: r.plan_notes ?? null, // planned行（計画インポート）の表示で使用
    raw_json_path: r.raw_json_path ?? null,
  };
}

function listSessions(month) {
  const rows = month
    ? db.prepare(BASE_SELECT + ' WHERE sl.date LIKE ? ORDER BY sl.date ASC, sl.created_at ASC').all(month + '-%')
    : db.prepare(BASE_SELECT + ' ORDER BY sl.date ASC, sl.created_at ASC').all();
  return rows.map(toLegacy);
}

function getSession(id) {
  return toLegacy(db.prepare(BASE_SELECT + ' WHERE sl.id = ?').get(id));
}

module.exports = {
  listSessions,
  getSession,
  SECTION_TO_SESSION_TYPE,
  SESSION_TYPE_TO_SECTION,
  ACTIVITY_TO_SLOT_TYPE,
};
