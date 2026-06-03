# 作業ログ

## 2026-06-03 — Phase 1 実装

### 実装内容

#### インフラ・サーバー
- `package.json` — Node.js + Express + SQLite (`better-sqlite3`) + dotenv + uuid 構成
- `server/db/database.js` — SQLite 初期化（sessions / phases / shoes / settings テーブル）
- `server/db/seed.js` — 起動時シード（ダミー19件 + sample_sessions.json 読み込み、ラップはメモリストアへ）
- `server/laps-store.js` — ラップデータのインメモリストア（DBに保存しない設計）
- `server/index.js` — Express エントリポイント、静的ファイル配信

#### APIルート
- `server/routes/sessions.js` — セッション CRUD + `/months` + `/autocomplete/:field` + `/:id/laps`
- `server/routes/phases.js` — フェーズ CRUD
- `server/routes/shoes.js` — シューズ CRUD（total_km 自動集計）
- `server/routes/export.js` — TSV（UTF-8 BOM）・Markdown エクスポート
- `server/routes/ai.js` — AI 評価（Phase 1: ダミーレスポンス、ラップ件数付き）

#### フロントエンド SPA
- `public/index.html` — SPA シェル（Chart.js CDN）
- `public/css/style.css` — ヘッダー・テーブル・詳細パネル・モーダル等のスタイル
- `public/js/app.js` — 全フロントエンドロジック（約1000行）
  - 月ナビゲーション（← / YYYY年M月クリックでカレンダーピッカー / →）
  - セッションテーブル（全列・固定列・横スクロール・行色分け・アイコン）
  - インライン編集（menu / memo / locate / shoes / impression + サジェスト補完）
  - アクティビティタイプ トグルフィルター（🏃 / 💤 / 📝）
  - フリーテキスト検索（menu・メモ・感想・AI評価を横断）
  - 列ソート（ヘッダークリックで昇降順）
  - フェーズサマリーバー（フェーズ終了月の末尾に自動挿入）
  - AI 評価ボタン（Claude / GPT、Phase 1 ダミー）・一括評価
  - TSV エクスポート（月単位 / 全件 / 選択行）
  - Markdown エクスポート + クリップボードコピー
  - セッション詳細パネル（右スライドイン）
    - サマリーカード（距離・タイム・ペース・HR・TRIMP・VO2max）
    - バイオメカニクスカード（GCT・上下動・歩幅・GCB、セッション平均）
    - ラップテーブル（pace / HR / W / Cad / GC / VO / Stride / GCB、102ラップ対応）
    - ラップグラフ（Chart.js ライン: ペース・HR・GCT・上下動）
    - 編集フォーム（menu / memo / locate / shoes / impression）
  - 設定画面（APIキー・シューズ管理・フェーズ管理・列設定・データ管理）
  - セッション追加 / 削除

#### インポートスクリプト
- `server/scripts/import_spreadsheet.js`
  - `data/spreadsheet_sessions.json`（184件）+ `data/sample_sessions.json`（1件）をインポート
  - 重複チェック: date + distance_km が同じ行はスキップ
  - `--clean` でダミーセッション削除後にインポート
  - `--dry-run` で件数確認のみ

---

### データソース

| ファイル | 件数 | 内容 |
|---|---|---|
| `data/spreadsheet_sessions.json` | 184件 | スプレッドシート手動データ（2025-12〜2026-05） |
| `data/sample_sessions.json` | 1件 | Suunto JSON エクスポート（100kmウルトラマラソン、102ラップ） |

---

### 設計判断・メモ

#### データソース（設計書 10章）
- FIT ではなく **Suunto JSONエクスポート** を正式採用
- JSON ではラップレベルでバイオメカニクス（GCT / VO / Stride / GCB）が取得可能
- FIT はラップレベルのバイオメカニクスが含まれない

#### 変換仕様（Runalyze 照合済み）
| フィールド | 変換式 | 備考 |
|---|---|---|
| HR (JSON bps) | × 60 = bpm | Lap HR.Avg = 2.25 bps → 135 bpm |
| vertical_oscillation_cm | × 100 = cm | 0.083 → 8.3cm |
| ground_contact_ms | × 1000 = ms | 0.256 → 256ms |
| stride_length_cm | × 100 = cm | 1.024m → 102.4cm |
| date | ISO 文字列の先頭10文字 | JST タイムゾーンをそのまま使用 |

#### 既知の問題
- `spreadsheet_sessions.json` の一部セッションで `duration_s` / `pace_per_km_s` が60×の値（スプレッドシートの変換誤り）。Phase 3 の Suunto API 連携後に上書きされる予定のため暫定許容

#### テーブル列設計
- CS（cadence_score）列: メインテーブルから削除、詳細パネルのみ表示
- バイオメカニクス4列（GC / VO / Stride / GCB）: VO2max右隣に**常時表示**
- その他バイオ列（Cad最大 / Cad平均 / GC左右）: 非表示（`bio: true`）

#### ラップデータ設計
- DB に保存しない（設計書通り）
- サーバー起動時に `sample_sessions.json` から `laps-store.js` のメモリに読み込み
- AI 評価ボタン押下時にラップデータを添付してコンテキストに含める

---

### 起動・インポート方法

```bash
# 初回セットアップ
npm install

# スプレッドシートデータをインポート（初回）
node server/scripts/import_spreadsheet.js --clean

# サーバー起動
npm start
# → http://localhost:3000
```

---

### 次のステップ（Phase 2）

- Anthropic API 連携（`claude-sonnet-4-20250514`）→ `claude_eval` 列に書き込み
- OpenAI API 連携（`gpt-4o-mini`）→ `gpt_eval` 列に書き込み
- `.env` ファイルに `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` を設定
