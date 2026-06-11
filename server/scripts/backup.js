/**
 * 手動入力分の定期バックアップ（docs/suunto_design_v5.md 3.5）
 * DBにしか無いデータ（slots / evaluations / phases / reports / shoes）をJSONダンプする。
 * results は生JSON（data/suunto_raw/）から再構築可能なため対象外。
 *
 * 実行：npm run backup → data/backup/backup_YYYYMMDD_HHMMSS.json（30世代を超えた古い分は自動削除）
 *
 * 手動リストア手順（リストア機能はYAGNIで作らない）：
 *   1. バックアップJSONの tables.<テーブル名> が行配列。各行のキー＝列名がそのままINSERT列
 *   2. 対象テーブルを空にしてから投入する：sqlite3 data/tracker.db "DELETE FROM slots;" 等
 *   3. node等で各行を INSERT INTO <テーブル名> (キー列挙) VALUES (値列挙) で再投入
 *      （better-sqlite3なら db.prepare(`INSERT INTO slots (${cols}) VALUES (${'?'.repeat...})`) をループ）
 *   4. 投入後に件数照合：SELECT COUNT(*) が meta.counts と一致すること
 */
const path = require('path');
const fs = require('fs');
const db = require('../db/database');

const BACKUP_DIR = path.join(__dirname, '../../data/backup');
const TABLES = ['slots', 'evaluations', 'phases', 'reports', 'shoes'];
const MAX_GENERATIONS = 30;

function tableExists(name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

function ts() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

fs.mkdirSync(BACKUP_DIR, { recursive: true });

const tables = {};
const counts = {};
for (const t of TABLES) {
  if (!tableExists(t)) continue;
  tables[t] = db.prepare(`SELECT * FROM ${t}`).all();
  counts[t] = tables[t].length;
}

const dump = {
  meta: {
    generated_at: new Date().toISOString(),
    db: 'data/tracker.db',
    counts,
  },
  tables,
};

const filename = `backup_${ts()}.json`;
fs.writeFileSync(path.join(BACKUP_DIR, filename), JSON.stringify(dump, null, 1), 'utf8');

console.log(`バックアップ作成: data/backup/${filename}`);
for (const [t, n] of Object.entries(counts)) console.log(`  ${t}: ${n}件`);

// 世代管理：30世代を超えた古いファイルを削除
const generations = fs.readdirSync(BACKUP_DIR)
  .filter(f => /^backup_\d{8}_\d{6}\.json$/.test(f))
  .sort(); // ファイル名＝タイムスタンプ順
const excess = generations.slice(0, Math.max(0, generations.length - MAX_GENERATIONS));
for (const f of excess) {
  fs.unlinkSync(path.join(BACKUP_DIR, f));
  console.log(`  古い世代を削除: ${f}`);
}
console.log(`世代数: ${Math.min(generations.length, MAX_GENERATIONS)} / ${MAX_GENERATIONS}`);
