# Suunto ランニング記録アプリ 詳細設計書 ver.5.1
2026年6月 ／ slot-result分離アーキテクチャ改訂版

> **v4からの主要変更**：①slot（トレーニング枠）とresult（実績）の分離、②生JSON＝真実の源（DBは導出キャッシュ）、③3ビュー構成（カレンダー／分析／トレンド）、④構造化差分をAI評価の中核に。v4の正解部分（vanilla JS・SQLite・ラップ非保存・常駐プロンプト・AI役割分担）は維持。
>
> **v5.0→v5.1の変更**：⑤設計原則「スキーマに過去の事情を書かない」を追加（3.5）。avg_hr_pct列を廃止し移行スクリプト側でbpm推定換算。⑥移行マッピングを確定（5.3）：旧menuはplan/actual両方へコピー、移行データはstatus=done扱い、gpt_eval移行時locked=1。

---

## 0. v5改訂の背景

Phase 1モックアップを実際に触った結果、以下の構造的歪みが判明した。

| 歪み | 原因 | v5での解決 |
|------|------|-----------|
| 「予定と実績の紐付け」が複雑化 | sessionsテーブル（実績ログ）に planned_menu 等を後付けした同居型 | slot/result分離 |
| API補正・再インポートでID/評価が壊れる懸念 | DBが唯一のデータ保管場所 | 生JSON＝真実の源、DB＝導出キャッシュ |
| 26列テーブルの認知負荷 | スプレッドシート完全再現から出発 | 用途別3ビュー（日常は列を絞る） |
| AI評価の文脈不足 | 実績データのみ送信 | plan vs result の構造化差分を送信 |

このアプリの本質は「記録」ではなく「**計画に対する進捗評価（PDCA）を回すエンジン**」である。v5はこの本質に合わせてデータモデルを再編する。

---

## 1. 背景と目的（v4から継承）

### 1.1 解決する課題

SuuntoはスマホアプリのみでPC・タブレットでの俯瞰・分析が困難。現状の手作業（Suunto→スプレッドシート手動転記→ChatGPTへコピペ評価依頼→返信コピペ）を自動化する。

### 1.2 ゴール

**計画と実績を一体で見るトレーニングカレンダー（PDCAエンジン）**

```
Plan  : フェーズレポート（常駐プロンプト）+ 計画TSVインポート / AIメニュー生成
Do    : Suunto生JSON取り込み（将来API自動取得）
Check : 構造化差分 + AI評価（計画に対する進捗評価）
Act   : フェーズ振り返り → 次計画へ（チャットで作戦会議 → レポート常駐）
```

### 1.3 ユーザー・運用前提

- 個人利用（rinta221）。2027年2月フルマラソン サブ3.5目標
- 時計でWU/メイン/CDを別々に記録 → 1ワークアウト=1生JSON
- 計画はChatGPT/Claudeとの対話でTSV形式（date/dow/menu/notes/section/locate/shoes）として作成する運用が既に確立している

---

## 2. システム概要

### 2.1 技術スタック（v4から変更なし・確定）

| レイヤー | 技術 | 備考 |
|---------|------|------|
| フロントエンド | HTML + CSS + JavaScript（vanilla SPA） | React不採用を維持。状態ストアのみ軽く整える |
| バックエンド | Node.js + Express | APIキー保護のため必須 |
| データ保存 | SQLite | **生JSONから導出されるキャッシュ**と位置づける（3.1参照） |
| AI連携 | Anthropic API / OpenAI API | サーバーサイドからのみ |
| Suunto連携 | 生JSONパーサー（手動D&D → 将来API差し替え） | パーサーは資産・入口だけ交換 |
| 実行環境 | ローカル（localhost） | 将来クラウド移行を想定した抽象化 |

### 2.2 開発フェーズ（v5再編）

| Phase | 名称 | 内容 | 状態 |
|-------|------|------|------|
| 1 | モックアップ版 | テーブル・月ナビ・編集・取り込みモーダル等 | **完了** |
| 1.5 | **slot/result移行** | データモデル再編。既存機能を保ったままスキーマ移行 | ←今ここ |
| 2 | カレンダー版 | 計画TSVインポート・予定行表示・実績紐付け（手動） | |
| 3 | AI評価版 | 構造化差分 + 常駐レポートでAI評価API接続 | APIキー取得後 |
| 3.5 | メニュー生成版 | AIメニュー生成TSV→計画インポートに接続 | |
| 4 | 自動化版 | Suunto API / Runalyze API自動取得・自動マッチング・トレンドビュー | API契約後 |

---

## 3. データアーキテクチャ（v5の核心）

### 3.1 生JSON＝真実の源（Source of Truth）

```
data/raw/                     ← 真実の源（生JSONを全保管）
  suunto/20260607_wu.json
  suunto/20260607_main.json
  imports/spreadsheet_v7.tsv  ← スプレッドシート移行の原本
  plans/plan_202606.tsv       ← 計画TSVの原本
       ↓ パーサー / インポーター（再実行可能）
SQLite（slots / results / evaluations ...）
       ↑ DBは「導出キャッシュ」。npm run rebuild で生データから全再構築できる
```

- DB破損・スキーマ変更を恐れない。原本さえあれば作り直せる
- ただし**手動入力（menu実績・感想・AI評価・ロック）はDBにしか無い**ため、これらは定期エクスポート（JSONダンプ）でバックアップする

### 3.2 slot / result 分離モデル

**slot（トレーニング枠）= 計画・意図のレイヤー。1行1セクション**

```sql
CREATE TABLE slots (
  id           TEXT PRIMARY KEY,   -- UUID（計画作成時に発番、以後不変）
  date         TEXT NOT NULL,      -- YYYY-MM-DD
  section      TEXT,               -- 'wu' / 'main' / 'cd' / NULL（ランオフ等は NULL）
  slot_type    TEXT NOT NULL,      -- 'run' / 'rest' / 'cross'（旧activity_typeに相当）
  status       TEXT NOT NULL DEFAULT 'planned',
               -- 'planned'（予定のみ）/ 'done'（実績紐付け済）/
               -- 'skipped'（予定したが未実施）/ 'unplanned'（予定外に実施）
  plan_menu    TEXT,               -- 計画メニュー名（例：構造再起動）
  plan_notes   TEXT,               -- 計画の狙い・指示（不変。評価軸として機能）
  plan_locate  TEXT,               -- 予定の場所
  plan_shoes   TEXT,               -- シューズ候補（フリーテキスト「A / B」可）
  actual_menu  TEXT,               -- 実績メニュー（実際やったこと・手動）
  memo         TEXT,               -- 実施後のメモ（自由記述）
  impression   TEXT,               -- 感想（AI送信必須項目）
  phase_id     TEXT,               -- FK -> phases.id
  source       TEXT DEFAULT 'manual', -- 'manual' / 'tsv_import' / 'ai_generated'
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
```

**result（実績）= Suunto等の計測データのレイヤー。1計測=1レコード**

```sql
CREATE TABLE results (
  id                  TEXT PRIMARY KEY,
  slot_id             TEXT,            -- FK -> slots.id（NULL=未紐付け）
  suunto_workout_id   TEXT UNIQUE,     -- 生JSONファイル名 or API ID（重複防止の自然キー）
  raw_json_path       TEXT,            -- data/raw/suunto/xxx.json（ラップ再取得用）
  start_time          TEXT,            -- 開始時刻（自動マッチングに使用）
  distance_km         REAL,
  duration_s          INTEGER,
  pace_per_km_s       INTEGER,
  avg_hr_bpm          INTEGER,         -- bpm統一。移行データは %HRmax×MaxHR(200)÷100 で推定換算（Phase 4でAPI実測に置換）
  elevation_m         REAL,
  energy_kcal         INTEGER,
  title               TEXT,
  trimp               REAL,
  vo2max              REAL,
  ground_contact_ms   REAL,
  gcb_left_pct        REAL,
  vertical_oscillation_cm REAL,
  cadence_avg_spm     INTEGER,
  cadence_max_spm     INTEGER,
  stride_length_cm    REAL,
  source              TEXT,            -- 'suunto_json' / 'spreadsheet' / 'suunto_api'(将来)
  imported_at         TEXT NOT NULL
);
```

**evaluation（AI評価）= slotに紐づく**

```sql
CREATE TABLE evaluations (
  id          TEXT PRIMARY KEY,
  slot_id     TEXT NOT NULL,        -- FK -> slots.id
  ai          TEXT NOT NULL,        -- 'claude' / 'gpt'
  text        TEXT,
  locked      INTEGER DEFAULT 0,    -- 確定ロック（v4 5.5の機構を継承）
  created_at  TEXT,
  updated_at  TEXT
);
```

phases / reports / shoes テーブルはv4の設計を継承。

### 3.3 なぜ分離するか（設計原理）

| 問題 | 同居型（v4） | 分離型（v5） |
|------|------------|------------|
| 予定なしで走った | planned系が空の行を作る（状態が暗黙的） | slot自動生成(status=unplanned)+result |
| 予定したが走らなかった | 実績列が空のまま（「未実施」か「未入力」か不明） | status=skipped で明示 |
| 紐付けの付け替え | 行の中身を移し替える | result.slot_id を更新するだけ |
| API補正・再インポート | 手動列を保護しながら上書き（壊れやすい） | resultを差し替えるだけ。slot（計画・評価・ロック）は無傷 |
| 1日複数セッション | 行の複製で表現 | slotがWU/main/CDで自然に複数 |

### 3.4 状態遷移

```
【計画インポート】 slot 作成（status=planned、plan_*が埋まる）
       ↓ 当日走る → Suunto取り込み
【紐付け】 result 作成 → slot_id を選択（手動）→ slot.status=done
       ↓ 走らなかった場合
【スキップ】 slot.status=skipped（理由は memo へ）
       ↓ 予定が無いのに走った場合
【予定外】 取り込み時に slot を即席生成（status=unplanned）して紐付け
```

### 3.5 設計原則：スキーマに過去の事情を書かない（v5.1）

slots / results / evaluations は「過去データが存在しなくても同じ形になる」グリーンフィールド設計を保つ。スプレッドシート移行の特殊事情（%HR表記・カンマ小数点・MM:SS:00・表記揺れシューズ等）は**全て移行スクリプト／インポーターのコードに隔離**し、スキーマには持ち込まない。

- 例：avg_hr_pct 列は持たない。移行スクリプトが `bpm = round(pct × MaxHR(200) ÷ 100)` で推定換算して avg_hr_bpm に投入（移行データはモック扱いのため推定で十分。Phase 4のAPI置換で実測になる）
- result は「100%機械由来の計測値」であることを不変条件とする。手動入力は slot 側（actual_menu / memo / impression）と evaluations のみ → バックアップ対象が slots / evaluations に確定する

---

## 4. ビュー設計（3ビュー構成）

### 4.1 カレンダービュー（主役・既存テーブルの進化形）

- **1行 = 1 slot**（実績があれば result の値を同じ行に表示）
- 列（既定）：date / dow / section / menu（plan→actualを2段 or 切替表示）/ notes / locate / shoes / 距離 / タイム / ペース / HR / TRIMP / 感想 / AI評価
- バイオメカ詳細・kcal・標高等は**既定で非表示**（設定で表示可、または分析ビューへ）
- **未来の予定行**：status=planned を薄色＋点線枠等で「予定」と視覚区別
- status=skipped はグレーアウト＋取り消し線等
- 月ナビ・同日グルーピング・activity_typeトグル・検索・インライン編集はv4を継承
- 既定表示月＝**今日を含む月**（予定が見えることが主目的になるため）

### 4.2 分析ビュー（既存ドロワーの継承）

- slot単位の深掘り：サマリー・バイオメカ平均・ラップテーブル・グラフ（HR/ペース/GCB/GCT/VO）
- ラップは raw_json_path から都度パース（DB非保存はv4方針を維持）
- ドロワー幅40vw・背面マスク貫通・別行クリック切替はv4のUX決定を維持

### 4.3 トレンドビュー（新設・Phase 4）

- 月またぎの推移：週間距離 / TRIMP / VO2max / GCB / 歩幅・ケイデンスの長期変化
- フェーズ（phases）の区間を背景帯で表示し「フェーズごとの伸び」を見る
- PDCAの Check を月次より長いスパンで支える

---

## 5. データ取り込み

### 5.1 Suunto生JSON取り込み（v4 15章を継承・強化）

- 入口：手動D&D（1ファイルずつ基本）→ 将来Suunto API/Runalyze APIに差し替え
- パーサー：server/lib/suunto-parser.js（検証済み変換仕様は付録Aに集約）
- 取り込みフロー：
  1. D&D → パース → プレビュー（サマリー・バイオメカ・ラップ明細）
  2. 重複チェック：suunto_workout_id（自然キー）で照合 ※date+distance+durationより堅牢
  3. **紐付け選択**：同日の status=planned な slot をプルダウン提示 →「6/13 メインの予定」を選ぶ
     - 該当slotが無い場合「予定外として取り込む」→ slot即席生成（status=unplanned）
  4. 承認 → result 作成・slot更新（status=done）・生JSONを data/raw/suunto/ へ保管
- 将来の自動マッチング：date + section + start_time順で自動提案 → ユーザーは確認のみ

### 5.2 計画TSVインポート（新設）

- 形式：date / dow / menu / notes / section / locate / shoes（タブ区切り、ユーザーの既存運用と同一）
- 貼り付け or ファイルアップロード → プレビュー → 承認で slots を一括作成（status=planned）
- section列：WU/メイン/CD → wu/main/cd に正規化。空欄はNULL（ランオフ等）
- menu列に「ランオフ」を含む行は slot_type=rest
- 日付の年補完：対象期間を指定（例：2026年）
- 既存slotとの重複（同date+section）は警告し、上書き/スキップを選択
- **AIメニュー生成（v4 11章）の出力TSVもこの同じインポーターに通す**（機構を1本化）

### 5.3 スプレッドシート移行データ（過去280件）

- 位置づけ：**モックデータ扱い**。将来Suunto/Runalyze APIで正確な実績に置換（v4 14章の補正構想を継承）
- マッピング（v5.1で確定）：
  - **旧menu → plan_menu と actual_menu の両方にコピー**（両表示モードで空欄を作らない・API置換に影響しない）。旧planned_menu（AI提案）が存在する行は plan_menu に旧planned_menu を優先（`plan_menu = COALESCE(旧planned_menu, 旧menu)`）
  - **status は一律 done**（厳密には計画なし=unplannedだが、過去全行に「予定外」の視覚表現が乗るのを避ける実用判断。ランオフ行は slot_type=rest, status=done）
  - 旧memo → memo、旧impression → impression、旧locate → plan_locate、旧shoes → plan_shoes
  - 数値系 → result（source='spreadsheet'）。avg_hr_pct は推定bpmに換算（3.5）
  - 旧claude_eval / gpt_eval → evaluations 2行に分解。**gpt_eval が非空の行は locked=1 で投入**（172件の保護。v4 5.5の懸案をここで解消）

---

## 6. AI評価（構造化差分を中核に）

### 6.1 送信ペイロード（slot単位）

```json
{
  "plan":   { "menu": "構造再起動", "notes": "登りで頑張らない。下りで遊ばない", "shoes": "Boston13" },
  "actual": { "menu": "砧岡本2周", "distance_km": 3.34, "pace": "5:59/km", "avg_hr_bpm": 142,
              "laps": [ ...全ラップ（rawから都度取得）... ] },
  "diff":   { "status": "done", "menu_match": false, "summary": "予定1周のところ2周実施" },
  "impression": "ユーザーの感想（必須）",
  "resident_reports": [ ...有効期間内のフェーズレポートmd（v4 12章）... ]
}
```

- **plan.notes（狙い）を必ず評価軸として渡す**。「狙い通りに走れたか」を評価の中心に
- status=skipped のslotも評価可能（「なぜ飛んだか」を含めPDCAの材料に）
- 1日まとめ評価：同日の全slot（WU/main/CD）を束ねて送る（v4 13章を継承）

### 6.2 AI役割分担（v4から維持）

- claude_eval＝客観コーチ（事実・改善点。褒めない）
- gpt_eval＝寄り添いコーチ（感情サポート・継続後押し）
- ロック機構（確定→🔒→解除）はevaluationsテーブルのlockedで継承。一括UIは作らない

---

## 7. v4から維持する決定事項（再掲・短縮）

| 項目 | 内容 |
|------|------|
| 表示フォーマット規約 | 歩幅m・小数2桁／HR bpm整数／VO cm小数1桁／GCB %小数1桁／Cadence spm整数（v4 4.5） |
| シューズ欄 | 暫定フリーテキスト→将来正規化プルダウン（v4 9.1） |
| フェーズレポート常駐プロンプト | reportsテーブル・有効期間・評価/生成時に自動送信（v4 12章） |
| フェーズ管理 | phasesテーブル・月サマリーバー |
| エクスポート | TSV / Markdown |
| ラップ | DB非保存・rawから都度取得 |
| 変換仕様 | 付録A（HR×60、Cadence×60×2、Stride=Speed÷(Cad×2)、Autolap抽出、null安全、ascent/descent分離、カンマ小数点、Duration MM:SS:00…全てv4検証済み値を継承） |

---

## 8. 移行計画（Phase 1.5：既存を壊さない段階移行）

0. **即時対応**：現行 sessions を保護 `UPDATE sessions SET gpt_eval_locked=1 WHERE gpt_eval IS NOT NULL AND gpt_eval != '';`（移行完了まで現行アプリが動き続けるため、移行とは独立に先に流す）
1. **スキーマ追加**：slots / results / evaluations を新規作成（既存sessionsは残す）
2. **移行スクリプト**：sessions → slot+result+evaluation に分解コピー（npm run migrate-v5）。マッピングは5.3で確定済み
   - source=suunto の行 → slot(status=done) + result(source='suunto_json')
   - スプレッドシート行 → slot + result（数値・推定bpm）+ evaluations（gpt有りはlocked=1）
   - ランオフ行 → slot(slot_type=rest, status=done) のみ
   - 再実行可能にする（新3テーブルをDELETEしてから再投入。sessionsは読むだけで一切変更しない）
3. **API/フロント切替**：参照先を sessions → slots LEFT JOIN results に変更（レスポンス形状は互換維持でUI変更を最小化）
4. **検証**：280件＋6月実績が新ビューで同一表示になることを確認（件数照合：slots=旧全行数、results=running+manual行数、evaluations=claude/gpt評価数）。5/31の2行重複はそのままコピーされる（解消はPhase 4のAPI補正時）
5. **sessions廃止**：検証後にテーブルをリネーム退避（即削除しない）
6. その後 Phase 2（計画TSVインポート・予定行表示・紐付けUI）へ

> 原則：**一度に1レイヤーずつ**。スキーマ→API→UIの順に切り替え、各段階でロールバック可能に保つ。

---

## 9. 未決定事項

| 項目 | 検討時期 | 備考 |
|------|---------|------|
| 旧avg_hr_pctが%HRmaxである前提の確認 | Phase 1.5 | 移行スクリプトで値域を検査（概ね50〜95なら%、120以上ならbpm誤格納）し換算前にレポート |
| 自動マッチングの精度設計 | Phase 4 | date+section+start_time順。複数候補時のUI |
| トレンドビューの指標選定 | Phase 4 | 週間距離/TRIMP/VO2max/GCB推移ほか |
| Suunto API vs Runalyze API | 契約返答待ち | partners@suunto.com 返信待ち。代替＝Runalyze Supporter |
| 手動入力分の定期バックアップ方式 | Phase 1.5 | JSONダンプの自動化（slots/evaluationsが対象） |
| スプレッドシート移行分のAPI置換 | Phase 4 | v4 14章の date+近似distance マッチングを result差し替えに簡素化 |
| 距離保持rest行3件の正規化 | Phase 4 | 既知の特殊データ：2026-01-13 / 04-01 / 04-13（「ランオフ予定→実際は走った」、計11.1km）。移行ではslot_type=restのままresultを付与（データ無損失・表示同一性優先、2026-06-11確定）。API補正時に status=unplanned のrun slotへ正規化するか検討 |

---

## 付録A：Suunto生JSON変換仕様（検証済み・v4 15章から集約）

- ラップ抽出：DeviceLog.Windows[].Window.Type=='Autolap' のみ（Activity/Moveは除外、Lapイベントは別物）
- セッションサマリー：DeviceLog.Header から取得
- HR：bps×60=bpm ／ Cadence：rps×60×2=spm
- 歩幅：Speed[0].Avg ÷ (Cadence[0].Avg×2)（JSONのStrideフィールドは不正確のため不使用）
- VO：×100=cm ／ GCT：×1000=ms ／ Energy：÷4184=kcal ／ GCB：%そのまま
- 標高：ラップは ascent_m / descent_m 分離（表示「+0/-58m」）
- セッション平均のcadence/strideは全ラップ平均から算出（Header.Strideは両足値のため不使用）
- null安全必須：Ascent/Descent/MAXVO2がnullのケースあり。ラップ値は[{Avg,Max}]配列で[0].Avgアクセス、空配列ガード
- DeviceLog.Samples（数千〜数十万件）は使用しない
- Duration文字列（移行TSV）：MM:SS / MM:SS:00（=分秒）/ H:MM:SS（1時間超のみ）。距離はカンマ小数点（1,2km=1.2km）に注意
