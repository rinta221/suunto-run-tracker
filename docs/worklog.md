# 作業ログ

## 2026-06-11 — Phase 1.5後処理: バックアップ小物・フェーズまとめバー重複修正

### npm run backup（手動入力分の定期バックアップ）
- `server/scripts/backup.js` 新規 — DBにしか無いデータ（slots/evaluations/phases/reports/shoes）を
  `data/backup/backup_YYYYMMDD_HHMMSS.json` に1ファイルダンプ（meta=実行時刻・件数、30世代自動削除）
- results は生JSONから再構築可能なため対象外。リストアはYAGNI（手動手順をスクリプト冒頭コメントに記載）
- `.gitignore` に data/backup/ 追加。初回実行：slots 284 / evaluations 172 / phases 4 / reports 0 / shoes 0

### 5/31フェーズまとめバー重複の修正（public/js/app.js）
- 原因：`buildDisplayRows()` がフェーズ終了日（5/31）に一致する**各セッション行の後ろ**にまとめバーを
  挿入していたため、同日2行で2回描画。間に挟まったバーが prevDate をリセットし同日グルーピングも分断
- **移行前から存在するバグ**（切替コミット混入ではない）：切替前コミット(b80e733)をworktree+DBスナップショット
  で起動し同一データで比較 → 移行前も2回描画されることを確認。5/31両行の phase_id は新旧とも同一値で
  データ由来ではない
- 修正：同日同フェーズの最後の行の後にだけバーを挿入（3行）。5月=バー1回・同日グルーピング復活、
  6月の現行フェーズまとめ（end_dateなし経路）も正常を確認
- 副次確認：移行前後の「24回 vs 25回」差は5/30「移動日」（旧activity_type=manual・距離なし）が
  running 扱いになる既知差分。距離合計は同一（244.6km）

### 監視プロセスの正体
- localhost:3000 の自動再起動は **nodemon**（`node_modules/.bin/nodemon server/index.js`、
  ユーザーのターミナルセッションで起動中）によるもの。設定変更なし

---

## 2026-06-11 — Phase 1.5: API/フロント切替（sessions → slots LEFT JOIN results）

### 変更ファイル
- `server/db/slot-view.js` 新規 — slots/results/evaluations を旧sessions形状JSONへ変換する互換レイヤー（レスポンス形状互換でUI変更ゼロ）
- `server/routes/sessions.js` — GET/POST/PATCH/DELETE/months/autocomplete を slots ベースに切替
  - インライン編集の振り分け：menu→actual_menu、locate→plan_locate、shoes→plan_shoes、memo/impression→slots
  - AI評価系（text/at/locked）は evaluations にUPSERT。数値系は編集対象外（result由来）
  - DELETE は slot + result + evaluation を連鎖削除
- `server/routes/ai.js` — 403ロックガード・評価書き込みを evaluations テーブルへ切替
- `server/routes/import.js` — Suunto取り込みを slot+result 投入に変更（重複チェックは results JOIN slots、raw_json_path保存、ラップはslot idキー）
- `server/db/seed.js` — ラップ再ロードを raw_json_path → slot_id 基準に変更
- `server/routes/export.js` — 互換レイヤー経由に切替（HR列ヘッダを bpm に修正）
- `server/routes/shoes.js` / `server/routes/phases.js` — sessions参照を slots/results に変更

### 検証（ブラウザ localhost:3000 / Playwright）
- 月ナビ・同日グルーピング（6/7=WU/M/CD 3行）・ドロワー（サマリー/バイオメカ/ラップ4本）・🔒ロック表示 すべて移行前と同一
- ロック済みGPT評価への再評価 → 403（evaluations.locked参照）
- rest+距離行（4/1, 4/13）は💤スタイルのまま距離・タイム表示
- PATCH振り分け・DELETE連鎖・数値系無視・autocomplete・export を一時行でAPIテスト済み
- sessions テーブルは無傷（284件 / 距離1007.66 / locked 172）

### 表示上の既知の差分（仕様通り）
- HR列：スプレッドシート行も実bpm値表示（旧は%値をbpmラベルで表示していた）
- 旧activity_type='manual'の4行は🏃表示（manual→run マッピングによる）
- GC左右列（gc_balance・既定非表示）はv5廃止につき空欄

---

## 2026-06-11 — Phase 1.5: 移行スクリプト migrate-v5（全検証パス）

### 変更ファイル
- `server/scripts/migrate-v5.js` 新規 — sessions → slots/results/evaluations 分解コピー
  - 再実行可能（新3テーブルDELETE→再投入。sessionsは読むだけ）
  - HR換算：suunto行はbpm格納（パーサー仕様で確認）→そのまま、スプレッドシート行は %HRmax×200/100
  - GCB：gcb_left_pct優先。gc_balanceのみの11件は左値レスキューパース（全件成功）
  - rest行でも距離を持つ3行（1/13・4/1・4/13、計11.1km）はresultを付与（ユーザー確定。Phase 4でunplanned run slotへの正規化を検討）
- `package.json` — `npm run migrate-v5` 追加
- 検証結果：slots 284 / results 188 / evaluations 172（gpt locked=1 172）/ 距離合計1007.66一致 / 5/31=2slots / 6/7=wu・main・cd

---

## 2026-06-11 — Phase 1.5: slots/results/evaluationsスキーマ追加

### 変更ファイル
- `server/db/database.js` — v5設計（docs/suunto_design_v5.md 3.2）の3テーブルを追加
  - `slots`（トレーニング枠：計画・意図レイヤー）
  - `results`（実績：計測データレイヤー、suunto_workout_id UNIQUE）
  - `evaluations`（AI評価：slot紐付け、locked継承）
  - インデックス：idx_slots_date / idx_results_slot / idx_evals_slot
- 既存 sessions / phases / reports / shoes は無変更（読み取り専用で維持）
- 事前保護：`UPDATE sessions SET gpt_eval_locked=1 WHERE gpt_eval非空`（172件ロック確認）

---

## 2026-06-09 — 取り込みプレビューのラップテーブル単位を統一

### 変更ファイル
- `public/js/app.js` — プレビューモーダルのラップ行フォーマット修正
  - GCT: 数値のみ → `260 ms`
  - VO: 数値のみ → `9.1 cm`
  - 歩幅: `.toFixed(3)` 単位なし → `.toFixed(2) + ' m'`（例: `0.92 m`）

---

## 2026-06-08 — メインテーブルHR列の単位をbpmに変更

### 変更ファイル
- `public/js/app.js` — 列ヘッダー `HR%` → `HR`、表示フォーマット `%` → `bpm`

---

## 2026-06-08 — Suunto生JSON取り込みUI実装（設計書15章）

### 実装ファイル
- `server/index.js` — JSONボディ上限を20MBに拡大（Suunto生JSONのサイズ対応）
- `public/index.html` — 取り込みモーダルHTML追加（D&Dドロップゾーン・プレビューエリア・フォーム）
- `public/css/style.css` — 取り込みモーダル用スタイル追加
- `public/js/app.js` — 取り込みUI全ロジック実装

### 機能
- ヘッダーの「↑ 取り込み」ボタンからモーダルを開く
- JSONファイルをD&Dまたはファイル選択でアップロード（複数同時可）
- `/api/import/suunto/preview` でパース・重複チェック結果をプレビュー表示
- プレビューカード：日付・距離・タイム・ペース・HR・ラップ数・バイオメカ・ラップ明細テーブル
- 重複警告バナー（date+distance_km+duration_s で既存と照合）
- session_type 選択（ウォームアップ/メイン/クールダウン、ファイル名から自動推定済み）
- menu / memo / locate / shoes / impression の任意入力
- 「承認して取り込む」→ `/api/import/suunto/commit` でDB投入・生JSONを data/suunto_raw/ に保管
- 取り込み完了後、該当月に自動ジャンプしてテーブルを再描画

---

## 2026-06-07 — テストデータ・仕様補足書コミット

### コミット対象
- `data/suunto_raw/20260607_wu.json` — WU（1.73km / 2ラップ）生JSON
- `data/suunto_raw/20260607_main.json` — メイン（3.34km / 4ラップ）生JSON
- `data/suunto_raw/20260607_cd.json` — CD（1.76km / 2ラップ）生JSON
- `data/sessions_20260607.json` — 上記3本の変換済みセッションデータ（laps埋め込み）
- `docs/claudecode_15_parser.md` — 15章実装補足仕様書（変換ロジック・期待値表）
- `docs/handoff_prompt.md` — 引き継ぎプロンプト雛形

---

## 2026-06-07 — Suunto生JSONパーサー実装・6/7データ取り込みリハーサル（設計書15章）

### 実装ファイル
- `server/lib/suunto-parser.js` — 純粋関数パーサー（生JSON1件 → { session, laps }）
- `server/routes/import.js` — インポートルート（POST /api/import/suunto）
- `server/index.js` — `/api/import` ルート登録
- `server/db/seed.js` — 再起動時に data/suunto_raw/ からラップを再ロードする処理を追加

### 変換ロジック（検証済み）
- 取得元：HR/Cadence/Speed → Activity Window、GCT/VO/GCB → Header
- cadence_avg_spm / stride_length_cm → Activity Window の Avg から算出
- cadence_max_spm → Activity Window の Cadence.Max × 60 × 2
- 歩幅 → Speed / (Cadence × 2)（JSONのStrideフィールドは不正確のため不使用）
- pace → Math.round(durS / distKm)

### 投入結果（期待値との突き合わせ）
| セッション | dist | dur | pace | hr | cadAvg | cadMax | stride | gct | vo | gcb | elev | kcal | vo2max | laps |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| WU（warmup） | 1.73 | 771 | 446 | 132 | 162 | 192 | 95.5 | 265.4 | 9.3 | 51.3 | 7.2 | 79 | 52.0 | 2 |
| メイン（main） | 3.34 | 1198 | 359 | 142 | 162 | 166 | 103.3 | 265.6 | 9.3 | 50.6 | null* | 163 | 52.2 | 4 |
| CD（cooldown） | 1.76 | 686 | 390 | 141 | 164 | 194 | 94.6 | 257.0 | 9.0 | 51.0 | 26.0 | 89 | null | 2 |

*メインの elevation_m: Header.Ascent=null のため null（仕様書の "0" は誤記）。全値が期待値と一致。

### UIエンドポイント（温存）
- `POST /api/import/suunto/preview` — D&D UIで利用予定（将来実装）
- `POST /api/import/suunto/commit` — 承認後投入（将来実装）

## 2026-06-07 — 詳細パネルのシューズ欄をフリーテキスト化

- `<select>` → `<input type="text">` に変更
- 既存データの長文・表記揺れ（「Boston13 # 適正テスト...」「WR28 or Pegasus41」等）をそのまま表示・編集できるように
- 将来のシューズ管理機能実装時に正規化プルダウンを再設計予定

## 2026-06-05 — ドロワー幅40vw変更・AI評価ロック機構追加

### 変更内容
- 詳細パネル幅: `60vw` → `40vw`
- sessionsテーブルに `claude_eval_locked / gpt_eval_locked` フィールド追加（ALTER TABLE マイグレーション）
- AI評価の確定/解除ボタンをドロワーに追加（確定でボタン無効化＋🔒表示、解除は確認ダイアログあり）
- テーブルセルのAI評価列でも 🔒 表示対応
- `evaluateSession()` でロック状態チェック（ロック中は再評価不可）
- `/api/ai/evaluate` サーバー側でもロックチェック（403返却）
- `import_spreadsheet.js`: spreadsheet_sessions.json の gpt_eval 有り行は `gpt_eval_locked=1` で初期保護

## 2026-06-05 — 詳細ドロワーUI改善（幅60vw・マスク貫通・月ナビ左寄せ）

### 変更内容（設計書 7.2節 反映）
- 詳細パネル幅: `400px` → `60vw`（ラップテーブル11列が収まる幅）
- 背面マスク: `pointer-events: none` に変更（視覚的薄暗がりは維持しつつクリック・スクロールが背面テーブルに貫通）
- パネル自体: `pointer-events: auto`（ドロワー内の操作は通常通り）
- オーバーレイのクリックでパネルを閉じるイベントを削除（貫通設計に変更のため）
- 月ナビ: `justify-content: center` → `flex-start + padding-left:12px`（左寄せ）

---

## 2026-06-05 — ラップ標高を ascent_m/descent_m に分離・歩幅算出方法変更

### 変更内容
- `stride_length_m`: JSONの不正確なStrideフィールドを廃止 → `Speed ÷ (Cadence_rps × 2)` で再計算（Runalyze一致）
- `elevation_gain_m` を `ascent_m` + `descent_m` の2フィールドに分離
- ラップテーブルの `↑m` 列を `↑/↓` 列に変更（例：`+0/-58m`、`+93/-0m`）
- ラップAPI（sessions.js）: `elevation_gain_m` → `ascent_m`/`descent_m` に変更（旧フィールドへのフォールバック付き）
- DB `--clean` 再インポート済み

---

## 2026-06-05 — sample_sessions.jsonバグ修正・DB再インポート

### 変更内容
- `cadence_spm` 変換ミス修正：rps × 60 × 2 = spm（3 → 160/170/167...）
- セッション平均歩幅の定義統一：両足ストライド(204.9cm) → 片足歩幅(94.0cm)
- `cadence_avg_spm=166`、`stride_length_cm=94.0` をセッションに追加
- `--clean` オプションで DB 再インポート実施

---

## 2026-06-05 — ラップ表示改善：HR bpm化・GCBグラフ・Stride m統一・全ラップ表示

### 変更内容

#### data/sample_sessions.json（ユーザー更新）
- ラップHRフィールドを `avg_hr_pct`（異常値）→ `avg_hr_bpm`（正常bpm値）に変更
- 全102ラップに `gcb_left_pct`（左右接地バランス）を追加

#### server/routes/sessions.js
- ラップAPI（`/api/sessions/:id/laps`）で `avg_hr_bpm`/`max_hr_bpm` を返すよう変更

#### public/js/app.js
- ラップテーブルのHR列：`avg_hr_pct` → `avg_hr_bpm`（整数bpm表示）
- ラップテーブルのGCB列：`50.7% - 49.3%` → `50.7%`（左%のみ）
- ラップテーブルのStride列：`.toFixed(3)+'m'` → `.toFixed(2)+' m'`（小数2桁）
- ラップテーブル：間引き表示（最大30件）を廃止→全件表示（スクロール可・max-height:480px・sticky thead）
- セッション平均の歩幅：`stride_length_cm` → m変換・小数2桁表示
- メインテーブルのStride列：cm → m変換・小数2桁表示
- HRグラフ：`avg_hr_pct` → `avg_hr_bpm`、軸・ツールチップにbpm単位を追加
- GCBグラフ追加：50%基準線（破線）付き折れ線グラフ、Y軸48〜52%にズーム

---

## 2026-06-05 — README.mdに起動・停止コマンド追加

### 変更内容
- README.mdにサーバー起動・停止・開発モードの使い方を追記
  - 起動: `npm start` → http://localhost:3000
  - 停止: `Ctrl + C`
  - 開発モード: `npm run dev`（ファイル変更時自動再起動）

---

## 2026-06-04 — session_type列追加・同日グルーピング表示（13章実装）

### 変更内容

#### DBスキーマ変更
- `sessions.session_type TEXT` 列を追加（warmup / main / cooldown / NULL）
- ALTER TABLE + 既存runningセッションをmenu欄キーワードでバックフィル
  - warmup: 3件（WU/ウォームアップ/アップ走）
  - cooldown: 2件（CL/CD/クールダウン/ダウン走）
  - main: 152件（上記以外のrunning）

#### インポートスクリプト（import_spreadsheet.js）
- `inferSessionType(menu)` 関数を追加
- インポート時に自動推測してsession_typeをセット

#### UI（app.js / style.css）
- 同日複数セッションをグルーピング表示
  - 2行目以降の日付・曜日セルは空白（罫線で境界を示す）
  - グループ先頭行に `border-top: 2px solid` を適用
- session_typeバッジ（WU/M/CD）を同日複数セッション時のみ表示
  - 色：WU=青、M=緑、CD=紫

#### 未実装（Phase 2連携）
- 「この日をまとめて評価」ボタンはPhase 2のAI評価API実装時に追加

---

## 2026-06-04 — reportsテーブル追加（Phase 4 スキーマ先行定義）

### 変更内容

#### DBスキーマ変更
- `reports` テーブルを新設（CREATE TABLE IF NOT EXISTS で追加）
- 設計書12章「フェーズレポート（常駐プロンプト）機能」に対応するスキーマ
- 実装は Phase 2（AI評価API連携）完了後に着手予定（Phase 4）

| 列 | 型 | 備考 |
|---|---|---|
| id | TEXT PK | UUID |
| title | TEXT | レポート名 |
| content_md | TEXT | Markdown本文 |
| report_type | TEXT | roadmap / phase_review / theme / form |
| start_date | TEXT | 有効期間開始 |
| end_date | TEXT | 有効期間終了（NULL=無期限） |
| is_active | INTEGER | 常駐フラグ（AI評価時に送信） |
| priority | INTEGER | 複数レポート時の優先順位 |

---

## 2026-06-04 — planned_menu列追加・AI生成行UI実装

### 変更内容

#### DBスキーマ変更
- `sessions.planned_menu TEXT` 列を追加（AI提案メニュー、承認時にセット）
- `database.js` のCREATE TABLE定義に追加（dateの直後）
- ALTER TABLEマイグレーション実行済み
- `import_spreadsheet.js` の DB_COLS にも追加

#### UI変更（app.js / style.css）
- `source='ai_generated'` かつ `planned_menu` ありの行のメニューセルを2段表示
  - 1行目：`予定：{planned_menu}`（グレー、11px）
  - 2行目：`実績：{menu}`（予定と異なる場合はオレンジ・太字）
- AI生成行（`.row-ai-generated`）の行背景を薄黄色（`#fefce8`）でハイライト

---

## 2026-06-04 — sessionsテーブルにsource列追加

### 変更内容

#### DBスキーマ変更
- `sessions` テーブルに `source TEXT NOT NULL DEFAULT 'manual'` 列を追加
- 値: `'manual'`（スプレッドシート/手動）/ `'suunto'`（Suunto連携）/ `'ai_generated'`（Phase 2.5 AI生成）
- `database.js` のCREATE TABLE定義に追加
- ALTER TABLE マイグレーション実行済み（既存280件→`'manual'`、Suunto 1件→`'suunto'`）

#### インポートスクリプト更新（import_spreadsheet.js）
- `DB_COLS` に `source` を追加
- `suunto_workout_id` の有無で自動判定（`suunto_workout_id`あり→`'suunto'`、なし→`'manual'`）
- JSONデータに `source` フィールドがある場合はそのまま使用

#### 設計書更新
- `docs/design_v4.md` に11章「AI練習メニュー生成機能（Phase 2.5）」追加
- Phase 2（AI評価API連携）完了後に実装予定

---

## 2026-06-03 — データ修正・列仕様変更

### 修正内容

#### ペース/タイム異常値の修正（spreadsheet_sessions.json）
- スプレッドシートの変換バグで `duration_s` / `pace_per_km_s` が60×の値になっていた23件を修正（÷60）
- 修正ロジック：`pace_per_km_s > 750` かつ `pace/60 ∈ [150, 750]` → 60×バグと判定
- 解消不能な不整合データ（28件）は `duration_s = NULL`, `pace_per_km_s = NULL` に
  - Phase 3 の Suunto API 連携後に正しい値で上書きされる予定
- `import_spreadsheet.js` の `--clean` を全セッション削除に変更（再投入安全のため）

#### テーブル列変更（設計書 3.2節 L列仕様）
- CS列（cadence_score）をメインテーブルから削除
- バイオメカニクス4列（GC(ms)/VO(cm)/Stride/GCB(%)）を VO2max 右隣に常時表示
- バイオトグルボタン削除

#### HR列の表示修正
- 列ヘッダー `HR` → `HR%`（スプレッドシートデータは HR% 形式のため）
- 値に `%` サフィックスを追加（例：`74` → `74%`）

#### 運用ルール追加（CLAUDE.md）
- コミットメッセージは日本語
- コミット時は `docs/worklog.md` に追記

---

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

## 2026-06-11 — Phase 2 第1スライス: 計画TSVインポート

### 概要
TSV（date/dow/menu/notes/section/locate/shoes）を貼り付け→プレビュー→slotsへstatus='planned'で一括投入する機能を実装（docs/suunto_design_v5.md 5.2）。パーサーはUIから分離したモジュールとし、将来のAIメニュー生成の取込口として再利用可能にした。

### 実装内容
- **server/lib/plan-tsv-parser.js**: 純粋パーサーモジュール。日付行/継続行、M/D年解釈（年跨ぎ+1）、section変換（WU/メイン/CD→wu/main/cd）、slot_type判定（section有→run/無→rest）、曜日不一致は警告（取込可）
- **server/routes/import.js**: `/api/import/plan/preview`（DB投入なし・既存slot日付の検出含む）、`/commit`（トランザクションで全件INSERT、原本をdata/plans/に保管、挿入id配列を返却）、`/undo`（返却idのみ削除、status='planned' AND source='tsv_import'に限定）
- **UI**: ヘッダー「📅 計画インポート」→モーダル（年セレクタ＋textarea貼り付け→プレビュー→取込実行→取り消しボタン）
- **表示対応**: planned行はグレートーン＋📅プレフィックス（plan_menu/plan_notes表示・実績列は空欄）。フェーズまとめ・月間距離/TRIMPはstatus='planned'を集計から除外。起動時は未来月でなく当月を開くよう修正
- **衝突ポリシー（v1）**: マッチング・上書き・スキップなし。既存slotがある日付でも計画slotをそのまま追加（計画と実績が並ぶ＝乖離が見える）。プレビューで既存slotあり日付を件数つき警告

### テスト結果（plan_20260601-0810.tsv / 年=2026）
- プレビュー: 期間2026-06-01〜08-10 / 71日 / slot総数109（rest37・3行run19日・1行run15日）/ 曜日不一致0件 / 既存slotあり=6/7のみ（done3件）→ すべて期待値どおり
- 取込: slots 284→393 ✓ / 取り消し→284 ✓ / 再取込→393 ✓
- 表示（Playwrightで確認）: 6月=計画行グレー混在・6/7が計画1＋実績3の4行グルーピング・月間6.8km/TRIMP83（実績のみ）・フェーズまとめ3回6.8km（計画除外）/ 7月=計画47行のみ0.0km / 8月=計画18行のみ / typeトグルはslot_typeで動作（run33/rest14）
- バックアップ: 取込前後で npm run backup 実施（284件→393件）
