/**
 * Suunto生JSON (DeviceLog.Header + Windows[]) → { session, laps } を返す純粋関数
 *
 * 取得元の原則（検証済み）：
 *   - 距離・時間・標高・エネルギー・vo2max・GCT・VO・GCB → Header
 *   - 平均HR・平均Cadence・最大Cadence・Speed（歩幅算出用）→ Activity Window
 *   - ラップ → Autolap Window（Type === 'Autolap'）のみ
 *   - cadence_avg_spm / stride_length_cm → Activity Window の Avg から算出
 *     （全ラップ平均より Activity Window の方が期待値に一致）
 */

function round1(v) { return Math.round(v * 10) / 10; }
function roundKm(m) { return Math.round(m / 1000 * 100) / 100; }

/** ファイル名サフィックスから session_type を推定 */
function sessionTypeFromFilename(filename) {
  const base = (filename || '').toLowerCase().replace(/\.json$/i, '');
  if (base.endsWith('_wu'))   return 'warmup';
  if (base.endsWith('_cd'))   return 'cooldown';
  return 'main';
}

/** Autolap Window 1件 → lap オブジェクト */
function parseLap(window, lapNumber) {
  const w = window.Window;
  const cadRaw   = w.Cadence?.[0]?.Avg ?? null;
  const speedRaw = w.Speed?.[0]?.Avg   ?? null;
  const hrRaw    = w.HR?.[0]?.Avg      ?? null;
  const hrMaxRaw = w.HR?.[0]?.Max      ?? null;
  const dist = w.Distance; // meters
  const dur  = w.Duration; // seconds (float)

  const cadSpm     = cadRaw ? Math.round(cadRaw * 60 * 2) : null;
  const strideLenM = (speedRaw && cadRaw)
    ? Math.round(speedRaw / (cadRaw * 2) * 1000) / 1000 : null;

  return {
    lap_number:              lapNumber,
    distance_km:             roundKm(dist),
    lap_duration_s:          Math.round(dur),
    pace_s:                  dist > 0 ? Math.round(dur / (dist / 1000)) : null,
    avg_hr_bpm:              hrRaw    ? Math.round(hrRaw * 60)    : null,
    max_hr_bpm:              hrMaxRaw ? Math.round(hrMaxRaw * 60) : null,
    ascent_m:                w.Ascent  != null ? Math.round(w.Ascent)  : null,
    descent_m:               w.Descent != null ? Math.round(w.Descent) : null,
    power_w:                 w.Power?.[0]?.Avg != null
                               ? Math.round(w.Power[0].Avg * 10) / 10 : null,
    cadence_spm:             cadSpm,
    ground_contact_ms:       w.GroundContactTime?.[0]?.Avg != null
                               ? Math.round(w.GroundContactTime[0].Avg * 1000) : null,
    vertical_oscillation_cm: w.VerticalOscillation?.[0]?.Avg != null
                               ? round1(w.VerticalOscillation[0].Avg * 100) : null,
    stride_length_m:         strideLenM,
    gcb_left_pct:            w.LeftGroundContactBalance?.[0]?.Avg != null
                               ? round1(w.LeftGroundContactBalance[0].Avg) : null,
  };
}

/**
 * 生JSONオブジェクト1件 → { session, laps }
 * @param {object} raw  - DeviceLog を含む生JSON
 * @param {string} filename - ファイル名（session_type 推定に使用）
 */
function parseSession(raw, filename) {
  const dl = raw.DeviceLog;
  const h  = dl.Header;

  // Activity Window（セッション全体サマリー。HR・Cadence・Speed の取得元）
  const actWin = (dl.Windows.find(w => w.Window.Type === 'Activity') || {}).Window || null;

  // ラップ（Autolap のみ。Activity / Move は除外）
  const laps = dl.Windows
    .filter(w => w.Window.Type === 'Autolap')
    .map((w, i) => parseLap(w, i + 1));

  // ---- Activity Window から取得 ----
  const hrAvgRaw  = actWin?.HR?.[0]?.Avg      ?? null;
  const cadAvgRaw = actWin?.Cadence?.[0]?.Avg ?? null;
  const cadMaxRaw = actWin?.Cadence?.[0]?.Max ?? null;
  const spdAvgRaw = actWin?.Speed?.[0]?.Avg   ?? null;

  const avgHrBpm    = hrAvgRaw  ? Math.round(hrAvgRaw  * 60)                       : null;
  const cadAvgSpm   = cadAvgRaw ? Math.round(cadAvgRaw * 60 * 2)                   : null;
  const cadMaxSpm   = cadMaxRaw ? Math.round(cadMaxRaw * 60 * 2)                   : null;
  const strideLenCm = (spdAvgRaw && cadAvgRaw)
    ? round1(spdAvgRaw / (cadAvgRaw * 2) * 100) : null;

  // ---- Header から取得 ----
  const distKm  = roundKm(h.Distance);
  const durS    = Math.round(h.Duration);
  const gcbLeft = h.LeftGroundContactBalance?.Avg ?? null;

  const session = {
    activity_type:            'running',
    source:                   'suunto',
    session_type:             sessionTypeFromFilename(filename),
    suunto_workout_id:        null, // 本番API連携（Phase3）で設定
    date:                     h.DateTime.slice(0, 10),
    planned_menu:             null,
    menu:                     null,
    memo:                     null,
    locate:                   null,
    shoes:                    null,
    distance_km:              distKm,
    duration_s:               durS,
    pace_per_km_s:            distKm > 0 ? Math.round(durS / distKm) : null,
    avg_hr_pct:               avgHrBpm,   // 列名はpctだがbpmで格納（既存データに倣う）
    elevation_m:              h.Ascent ? round1(h.Ascent) : null,
    cadence_score:            null,
    energy_kcal:              h.Energy ? Math.round(h.Energy / 4184) : null,
    title:                    'Running',
    trimp:                    h.EPOC   ?? null,
    vo2max:                   h.MAXVO2 != null ? round1(h.MAXVO2) : null,
    ground_contact_ms:        h.GroundContactTime?.Avg != null
                                ? round1(h.GroundContactTime.Avg * 1000) : null,
    gcb_left_pct:             gcbLeft != null ? round1(gcbLeft) : null,
    vertical_oscillation_cm:  h.VerticalOscillation?.Avg != null
                                ? round1(h.VerticalOscillation.Avg * 100) : null,
    cadence_max_spm:          cadMaxSpm,
    cadence_avg_spm:          cadAvgSpm,
    stride_length_cm:         strideLenCm,
    gc_balance:               gcbLeft != null
                                ? `${round1(gcbLeft)}% - ${round1(100 - gcbLeft)}%` : null,
    impression:               null,
    claude_eval:              null,
    claude_eval_at:           null,
    claude_eval_locked:       0,
    gpt_eval:                 null,
    gpt_eval_at:              null,
    gpt_eval_locked:          0,
  };

  return { session, laps };
}

module.exports = { parseSession, sessionTypeFromFilename };
