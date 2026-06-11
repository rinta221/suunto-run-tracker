/**
 * 計画TSVパーサー（docs/suunto_design_v5.md 5.2）
 *
 * date / dow / menu / notes / section / locate / shoes のタブ区切りテキストを
 * slots投入用の行配列に変換する。UIから分離した純粋モジュール
 * （将来のAIメニュー生成出力TSVも同じ入口に通す＝機構1本化）。
 *
 * 行の種類：
 * - 日付行（date非空）：その日の menu / notes を確定。section有り→run slot、無し→rest slot
 * - 継続行（date空）：直前の日付行の date / menu / notes を継承。section必須
 *
 * 戻り値：{ ok, errors, warnings, slots, summary }
 * - errors: [{line, message}] 1件でもあれば ok=false（取込不可）
 * - warnings: [{line, date, message}] 曜日不一致など（取込は可能）
 * - slots: [{date, section, slot_type, plan_menu, plan_notes, plan_locate, plan_shoes}]
 * - summary: { startDate, endDate, dayCount, slotCount, restCount, runSlotCount, runDaysByRows }
 *   runDaysByRows は「1日あたりのrun行数 → 日数」（例 {"1":15,"3":19}）
 */

const HEADER = ['date', 'dow', 'menu', 'notes', 'section', 'locate', 'shoes'];
const SECTION_MAP = { 'WU': 'wu', 'メイン': 'main', 'CD': 'cd' };
const DOW_JP = ['日', '月', '火', '水', '木', '金', '土'];

function parsePlanTsv(text, baseYear) {
  const errors = [];
  const warnings = [];
  const slots = [];

  if (!text || !text.trim()) {
    return { ok: false, errors: [{ line: 1, message: 'TSVが空です' }], warnings, slots, summary: null };
  }
  if (!Number.isInteger(baseYear) || baseYear < 2000 || baseYear > 2100) {
    return { ok: false, errors: [{ line: 0, message: '年の指定が不正です: ' + baseYear }], warnings, slots, summary: null };
  }

  const lines = text.replace(/\r\n/g, '\n').split('\n');

  // ヘッダー検査
  const header = (lines[0] || '').split('\t').map(c => c.trim());
  if (header.length !== HEADER.length || HEADER.some((h, i) => header[i] !== h)) {
    errors.push({ line: 1, message: `ヘッダーが不正です。期待: ${HEADER.join(' / ')}、実際: ${header.join(' / ')}` });
    return { ok: false, errors, warnings, slots, summary: null };
  }

  let year = baseYear;
  let prevMonth = null;
  let ctx = null; // 直前の日付行 { date, menu, notes }

  for (let i = 1; i < lines.length; i++) {
    const lineNo = i + 1;
    if (lines[i].trim() === '') continue; // 空行はスキップ

    const cols = lines[i].split('\t');
    if (cols.length > HEADER.length) {
      errors.push({ line: lineNo, message: `列数が多すぎます（${cols.length}列）` });
      continue;
    }
    while (cols.length < HEADER.length) cols.push('');
    const [dateRaw, dowRaw, menuRaw, notesRaw, sectionRaw, locateRaw, shoesRaw] =
      cols.map(c => c.trim());

    // section変換（WU→wu / メイン→main / CD→cd / 空→null）
    let section;
    if (sectionRaw === '') {
      section = null;
    } else if (SECTION_MAP[sectionRaw]) {
      section = SECTION_MAP[sectionRaw];
    } else {
      errors.push({ line: lineNo, message: `不明なsection値: 「${sectionRaw}」（WU/メイン/CD/空のみ）` });
      continue;
    }

    let date, menu, notes;
    if (dateRaw !== '') {
      // 日付行：M/D を年セレクタの年で解釈。月が前行より小さくなったら年+1（年跨ぎ）
      const m = dateRaw.match(/^(\d{1,2})\/(\d{1,2})$/);
      if (!m) {
        errors.push({ line: lineNo, message: `日付の形式が不正です: 「${dateRaw}」（M/D形式）` });
        continue;
      }
      const month = Number(m[1]), day = Number(m[2]);
      if (prevMonth !== null && month < prevMonth) year += 1;
      prevMonth = month;

      const d = new Date(Date.UTC(year, month - 1, day));
      if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
        errors.push({ line: lineNo, message: `存在しない日付です: ${year}/${dateRaw}` });
        continue;
      }
      date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      menu = menuRaw;
      notes = notesRaw;
      ctx = { date, menu, notes };

      // 曜日検査（不一致は警告。取込は可能）
      const actualDow = DOW_JP[d.getUTCDay()];
      if (dowRaw !== '' && dowRaw !== actualDow) {
        warnings.push({ line: lineNo, date, message: `曜日不一致: ${date} は「${actualDow}」ですがTSVは「${dowRaw}」` });
      }
    } else {
      // 継続行：直前の日付行から date / menu / notes を継承。section必須
      if (!ctx) {
        errors.push({ line: lineNo, message: '日付行より前に継続行があります' });
        continue;
      }
      if (!section) {
        errors.push({ line: lineNo, message: `継続行（${ctx.date}）のsectionが空です` });
        continue;
      }
      ({ date, menu, notes } = ctx);
    }

    slots.push({
      date,
      section,
      slot_type: section ? 'run' : 'rest', // section有り→run、無し→rest
      plan_menu: menu || null,
      plan_notes: notes || null,
      plan_locate: locateRaw || null,
      plan_shoes: shoesRaw || null,
    });
  }

  if (slots.length === 0 && errors.length === 0) {
    errors.push({ line: 1, message: 'データ行がありません' });
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    slots,
    summary: errors.length === 0 ? buildSummary(slots) : null,
  };
}

function buildSummary(slots) {
  const dates = [...new Set(slots.map(s => s.date))].sort();
  const restCount = slots.filter(s => s.slot_type === 'rest').length;

  // 1日あたりのrun行数 → 日数（例：3行構成19日、1行構成15日）
  const runRowsPerDay = {};
  for (const s of slots) {
    if (s.slot_type === 'run') runRowsPerDay[s.date] = (runRowsPerDay[s.date] || 0) + 1;
  }
  const runDaysByRows = {};
  for (const n of Object.values(runRowsPerDay)) {
    runDaysByRows[n] = (runDaysByRows[n] || 0) + 1;
  }

  return {
    startDate: dates[0],
    endDate: dates[dates.length - 1],
    dayCount: dates.length,
    slotCount: slots.length,
    restCount,
    runSlotCount: slots.length - restCount,
    runDaysByRows,
  };
}

module.exports = { parsePlanTsv };
