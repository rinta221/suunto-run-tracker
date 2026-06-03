const express = require('express');
const router = express.Router();
const db = require('../db/database');

const DOW_JP = ['日', '月', '火', '水', '木', '金', '土'];

function formatDuration(s) {
  if (!s) return '';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function formatPace(s) {
  if (!s) return '';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function dow(dateStr) {
  if (!dateStr) return '';
  return DOW_JP[new Date(dateStr).getDay()];
}

// GET /api/export/tsv?scope=all|month|selected&month=YYYY-MM&ids=id1,id2,...
router.get('/tsv', (req, res) => {
  const { scope, month, ids } = req.query;

  let sessions;
  if (scope === 'selected' && ids) {
    const idList = ids.split(',');
    sessions = idList
      .map(id => db.prepare('SELECT * FROM sessions WHERE id = ?').get(id))
      .filter(Boolean);
  } else if (scope === 'month' && month) {
    sessions = db.prepare("SELECT * FROM sessions WHERE date LIKE ? ORDER BY date ASC").all(month + '-%');
  } else {
    sessions = db.prepare("SELECT * FROM sessions ORDER BY date ASC").all();
  }

  const headers = [
    '日付', '曜日', '練習メニュー', 'メモ(練習内容)', '場所', 'シューズ',
    'Distance(km)', 'Duration', 'Pace(/km)', 'avg.HR%', 'Elev.(m)', 'CS',
    'Energy(kcal)', 'Splits', 'Title', 'TRIMP', 'VO2max',
    'Ground contact(ms)', 'GCB(%左)', '上下動(cm)', '最大ケイデンス(spm)', '平均ケイデンス(spm)',
    '平均歩幅(cm)', '左右接地バランス', '感想', 'Claude評価', 'GPT評価',
  ];

  const rows = sessions.map(s => [
    s.date,
    dow(s.date),
    s.menu || '',
    s.memo || '',
    s.locate || '',
    s.shoes || '',
    s.distance_km != null ? s.distance_km : '',
    formatDuration(s.duration_s),
    formatPace(s.pace_per_km_s),
    s.avg_hr_pct != null ? s.avg_hr_pct : '',
    s.elevation_m != null ? s.elevation_m : '',
    s.cadence_score != null ? s.cadence_score : '',
    s.energy_kcal != null ? s.energy_kcal : '',
    '',
    s.title || '',
    s.trimp != null ? s.trimp : '',
    s.vo2max != null ? s.vo2max : '',
    s.ground_contact_ms != null ? s.ground_contact_ms : '',
    s.gcb_left_pct != null ? s.gcb_left_pct : '',
    s.vertical_oscillation_cm != null ? s.vertical_oscillation_cm : '',
    s.cadence_max_spm != null ? s.cadence_max_spm : '',
    s.cadence_avg_spm != null ? s.cadence_avg_spm : '',
    s.stride_length_cm != null ? s.stride_length_cm : '',
    s.gc_balance || '',
    s.impression || '',
    s.claude_eval || '',
    s.gpt_eval || '',
  ]);

  const tsv = [headers, ...rows].map(r => r.join('\t')).join('\r\n');
  const bom = '﻿';
  res.setHeader('Content-Type', 'text/tab-separated-values; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="sessions_${scope || 'all'}.tsv"`);
  res.send(bom + tsv);
});

// GET /api/export/markdown?ids=id1,id2,...
router.get('/markdown', (req, res) => {
  const { ids, prompt } = req.query;
  let sessions;
  if (ids) {
    sessions = ids.split(',').map(id => db.prepare('SELECT * FROM sessions WHERE id = ?').get(id)).filter(Boolean);
  } else {
    sessions = db.prepare('SELECT * FROM sessions ORDER BY date ASC LIMIT 20').all();
  }

  const promptText = prompt || '以下のランニングデータを分析して、トレーニングの傾向と改善点を教えてください。';

  let md = `${promptText}\n\n`;
  md += `| 日付 | 曜 | メニュー | 距離 | ペース | HR% | TRIMP | 感想 |\n`;
  md += `|------|-----|---------|------|--------|------|-------|------|\n`;
  for (const s of sessions) {
    md += `| ${s.date} | ${dow(s.date)} | ${s.menu || '-'} | ${s.distance_km ? s.distance_km + 'km' : '-'} | ${formatPace(s.pace_per_km_s) || '-'} | ${s.avg_hr_pct ? s.avg_hr_pct + '%' : '-'} | ${s.trimp || '-'} | ${s.impression || '-'} |\n`;
  }

  res.setHeader('Content-Type', 'application/json');
  res.json({ markdown: md });
});

module.exports = router;
