# 実装依頼：Suunto生JSONパーサー（設計書15章）— 6/7リハーサル投入

## このタスクの位置づけ

設計書 `docs/design_v4.md` の **15章「Suunto生JSON取り込みフロー」** を実装する。
ただし今回は**リハーサル**。下記3ファイルを本日分（2026-06-07）としてDBにインポートできれば成功とする。

```
data/suunto_raw/20260607_wu.json    # warmup
data/suunto_raw/20260607_main.json  # main
data/suunto_raw/20260607_cd.json    # cooldown
```

**変換ロジックは設計書15章の仕様に完全準拠すること。** 本ファイルは15章を実装に落とすための補足。15章と食い違ったら15章を正とする。

---

## 今回のスコープ（リハーサルとして軽量化）

設計書15章は本番（Phase3）の完全仕様で、D&D UI・プレビュー・重複チェックまで含むが、**今回はそこまで作らない**。

| 設計書15章のタスク | 今回 |
|---|---|
| server/lib/suunto-parser.js（生JSON→DBスキーマ変換） | **作る**（本体・資産化の核） |
| POST /api/import/suunto | **作る**（ただし今回はファイルアップロードでなく data/suunto_raw/ スキャンで動かす） |
| D&D・プレビュー・承認UI | **今回は作らない**（設計書15章のUIタスクは将来のまま温存） |
| 重複チェック（date+distance+duration） | **今回は作り込まない**（やり直しはDBクリアで対応） |
| 元生JSONを data/suunto_raw/ に保管 | 既に配置済み（消さない） |

### 既存資産を壊さないこと（重要）
- もし既にSuunto取り込み系のUIやエンドポイント（/preview /commit 等）を実装していたら、**消さない・作り直さない**。将来の手動アップロード運用としてそのまま温存する。今回はそれを介さず別経路で通すだけ。
- 既存の `server/scripts/import_spreadsheet.js`、`laps-store.js`、一覧API・グルーピング表示には手を付けない。

---

## パーサー本体（server/lib/suunto-parser.js）

**純粋関数にする**：入力＝生JSONオブジェクト1件、出力＝`{ session, laps }`。ファイル読み/アップロード/API取得を知らない。これで将来の入口差し替え（手動→API）で本体を再利用できる。

### 入力構造
`DeviceLog.Header`（セッションサマリー）＋ `DeviceLog.Windows[]`（各種ウィンドウ）。1ファイル=1セッション。

### ラップ抽出元（設計書15章）
- `Windows[].Window.Type === 'Autolap'` のみがラップ（1kmごと＋端数）
- `Type === 'Activity'` / `'Move'` はセッション全体サマリー → **除外**
- `Lap`イベント（Samples内のStart/Stop）はラップとは別物 → **使わない**

### セッションサマリーの変換（Headerから取得）

| Headerフィールド | 変換 | DBフィールド |
|---|---|---|
| DateTime | 先頭10文字（JST日付そのまま） | date |
| Distance | ÷1000 | distance_km |
| Duration | 整数秒 | duration_s |
| Ascent | mそのまま | elevation_m |
| Energy | ÷4184 | energy_kcal |
| MAXVO2 | 小数1桁（nullあり=正常） | vo2max |
| **EPOC** | **整数に丸め** | **trimp** |
| GroundContactTime.Avg | ×1000 | ground_contact_ms |
| LeftGroundContactBalance.Avg | %そのまま | gcb_left_pct |
| VerticalOscillation.Avg | ×100 | vertical_oscillation_cm |
| pace | duration_s ÷ (distance_km) | pace_per_km_s |

- **cadence_avg_spm / stride_length_cm は全ラップの平均から算出**（Header.Strideは両足ストライドで定義が違うため使わない）。
- **avg_hr_pct**：Headerに平均HRが無い。今回は**全ラップのavg_hr_bpm平均（bpm値）を入れる**。※既存列名はavg_hr_pct（%前提）だが、生JSONからは%が出ないためbpmを暫定で格納。単位整理は将来Phase3で。
- session_type：ファイル名サフィックスから決定（_wu→warmup / _main→main / _cd→cooldown）
- source = 'suunto'、suunto_workout_id = null（手動JSONには存在しない。本番APIまで保留）
- planned_menu = null、menu/locate/shoes/memo/impression = 空文字、評価系=null、locked=0

### ラップの変換（Autolapウィンドウから）

| 取得元 | 変換 | フィールド |
|---|---|---|
| Distance | ÷1000 | distance_km |
| Duration | 整数秒 | lap_duration_s |
| HR[0].Avg / .Max | ×60 | avg_hr_bpm / max_hr_bpm |
| Power[0].Avg | そのまま | power_w |
| Cadence[0].Avg | ×60×2 | cadence_spm |
| GroundContactTime[0].Avg | ×1000 | ground_contact_ms |
| VerticalOscillation[0].Avg | ×100 | vertical_oscillation_cm |
| LeftGroundContactBalance[0].Avg | %そのまま | gcb_left_pct |
| **Speed[0].Avg ÷ (Cadence[0].Avg × 2)** | 歩幅算出 | stride_length_m |
| Ascent / Descent | 整数 | ascent_m / descent_m |
| pace | Duration ÷ (Distance/1000) | pace_s |

※ Window内の値は `{Avg,Max,Min}`。配列で包まれる場合あり（`win[key][0].Avg`）。両対応で取得すること。
※ JSONのStrideフィールドは不正確なので使わず、Speed÷(Cadence×2)で算出。

### ラップの保存先（設計書通り）
- ラップはDBに保存しない。既存の `laps-store.js`（インメモリストア）に載せる作法に合わせる。
- 元生JSONは `data/suunto_raw/` に保管済み（消さない）。AI評価時に再パースしてラップ取得。

---

## エンドポイント（POST /api/import/suunto）

- 設計書15章のエンドポイント名に合わせ `POST /api/import/suunto` を新設。
- **今回はリハーサルなので、ファイルアップロードを介さず** `data/suunto_raw/` 配下の `*.json` をスキャンしてパーサーに流し、DB投入する経路で動かす。
  - 実装が楽なら、bodyで `{ "mode": "raw_dir" }` を受けて data/suunto_raw/ を読む、等でよい。将来アップロード経路を足せる作りにしておく。
- レスポンスで「読込件数 / 投入件数 / 各セッションの主要数値」を返す。

---

## リハーサル成功条件

1. `POST /api/import/suunto`（raw_dirモード）で3ファイルが読まれ、6/7付けで3セッションがDBに入る
2. 画面（localhost:3000）で6/7が同日グルーピングされ3行（WU/メイン/CD）表示される
3. 各セッションの数値が下表の期待値と一致する
4. パーサーが生成するラップ数が WU=2 / メイン=4 / CD=2 になる（DB保存はしないが、ログ等で確認できること）

### 期待値（設計書15章方式で算出済み・これと一致すれば変換ロジック正解）

| | session_type | date | distance_km | duration_s | pace_per_km_s | avg_hr_pct(bpm暫定) | cadence_avg_spm | stride_length_cm | vertical_oscillation_cm | ground_contact_ms | gcb_left_pct | elevation_m | energy_kcal | vo2max | trimp(EPOC) | laps |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| WU | warmup | 2026-06-07 | 1.73 | 771 | 446 | 132 | 161 | 95.5 | 9.3 | 265.4 | 51.3 | 7.2 | 79 | 52.0 | 18 | 2 |
| メイン | main | 2026-06-07 | 3.34 | 1198 | 359 | 142 | 162 | 104.0 | 9.3 | 265.6 | 50.6 | 0 | 163 | 52.2 | 39 | 4 |
| CD | cooldown | 2026-06-07 | 1.76 | 686 | 390 | 141 | 164 | 95.5 | 9.0 | 257.0 | 51.0 | 26.0 | 89 | null | 26 | 2 |

※ 丸めによる±1程度のズレは許容。距離・ペース・HR・ケイデンス・trimpが大きく外れたら、取得元（Header / Autolap）と変換式を疑う。
※ CDのvo2maxはHeader.MAXVO2がnull（クールダウンで未算出）→ nullで投入が正常。0埋めしない。

---

## やり直し（重複対策の代わり）

重複チェックは今回作らないので、再投入したい時は6/7のsuunto由来行を削除してから再実行。気になればDBの該当日クリア用の簡易手段だけ用意してよい（任意）。

---

## 作業後に報告してほしいこと

1. `POST /api/import/suunto` のレスポンス（読込件数・投入件数）
2. 3セッションの主要数値（distance / pace / avg_hr / cadence_avg / stride / trimp / laps数）を期待値と並べて
3. 作ったファイルのパス（suunto-parser.js の場所、エンドポイント追加場所）
4. 既存のSuunto取り込みUI/エンドポイントがあったか、それを温存できたか
5. 期待値とズレた項目があれば、その値と取得元（Header / Autolap / どのフィールド）
