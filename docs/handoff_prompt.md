# Suunto ランニング記録アプリ開発 — 引き継ぎプロンプト（2026-06-07更新）

このプロンプトを新しいチャットの冒頭に貼り付けてください。あわせて以下のファイルを再アップロードすると確実です：
- suunto_design_v4.md（最新設計書・全14章＋4.5/5.5/9.1＋15章）※**最初に必ず読む**
- worklog.md（実装の作業ログ。既存実装の実態が分かる）※**指示前に確認する**
- sample_sessions.json（100kmウルトラ、102ラップ、全バイオメカ）
- spreadsheet_sessions.json（2025-12〜2026-05、280件）
- sessions_20260607.json（6/7のWU/メイン/CD変換済み・参考）＋ data/suunto_raw/ の6/7生JSON3本

---

## このチャットの役割

Suunto連携ランニング練習記録アプリ（PDCAエンジン）の設計・開発。
あなた（Claude）は **設計相談・データ変換・ブラウザUI確認(Claude in Chrome)・Claude Code(ターミナル)へ渡すプロンプト整理** を担当。実装はユーザーがローカルのClaude Codeで進める。日本語でやり取りする。

設計変更のたびに suunto_design_v4.md を更新 → present_files で提示 → ユーザーがDL → docs/design_v4.md に上書き → Claude Codeに伝達、という流れ。Claude Codeへの指示文を整形して渡すことが多い。設計判断は選択肢とトレードオフを示してから推奨を述べるスタイルが好まれる。

## 進め方ルール（必読・前チャットの反省から確立）

過去のチャットで、設計書を読まず推測で指示文を作り、設計書15章と食い違う指示を出してClaude Codeを混乱させた失敗があった。これを防ぐため以下を徹底する：

1. **設計書ファースト**：Suunto取り込み・スキーマ・変換仕様など設計に関わる指示を作る前に、必ず `suunto_design_v4.md` の該当章を実際に開いて引用する。記憶や推測で章を組み立て直さない。設計書に既に章がある場合、それが「正」。自分の案と食い違ったら設計書に合わせる。
2. **worklogを確認**：`worklog.md` に実装の実態（既存ファイル構成・既に決まった変換式・laps-store.js等の作法）が記録されている。指示前に該当箇所を読む。
3. **変換仕様は数値で裏取り**：変換ロジックの指示を出すときは、手元で実データを変換して期待値を算出し、指示文に期待値表として埋め込む。Claude Codeがその場で照合できるようにする。
4. **食い違いは止めて報告**：Claude Codeが「指示が矛盾」と指摘してきたら、勝手に優先順位を決めさせず、設計書を正として整合させた指示を出し直す。
5. **ローカルファイル（/Users/rmatsumoto/...）はClaudeから直接読めない**。チェック・検証はClaude Codeに監査チェックリストを渡して自己監査させる方式で行う（ブラウザ越しのfile://は非効率なので使わない）。
6. **既存資産を壊さない**：実装済みのUI・エンドポイントは、設計が進化しても「消す・作り直す」ではなく「温存して使わないだけ」を基本にする。

設計判断は選択肢とトレードオフを示してから推奨を述べる。Claude Codeへ渡す指示文・監査チェックリストは設計書の章番号と用語に揃える。

## ユーザー情報・目的

- ユーザー：rinta221 / 松本
- Suuntoの時計で記録するがスマホアプリのみでPC俯瞰が困難。現状はSuunto→スプレッドシート手動コピペ→ChatGPTにコピペ評価依頼→返信コピペ、という運用。これを自動化するアプリ
- 2026年5月に奈良100kmウルトラ完走。2027年2月フルマラソン（サブ3.5目標）へ練習特化、年明けからまたウルトラへ
- 本質は記録でなく「計画に対する進捗評価(PDCA)」を回すツール。目標はRunalyzeのようなもの

## 技術スタック（確定）

- フロント：HTML+CSS+JS（SPA）。**React不採用**（リアルタイム/双方向通信/頻繁な部分更新が無いため転機は来ない、vanillaで最後まで行く方針。状態ストアだけ軽く整える）
- バック：Node.js+Express、DB：SQLite（将来Supabase想定）
- 実行：ローカルlocalhost。APIキーは.envでサーバー管理
- ローカル：/Users/rmatsumoto/Documents/run/suunto-run-tracker
- GitHub：https://github.com/rinta221/suunto-run-tracker

## 開発フェーズ

Phase1=モックアップ(ほぼ完成) / Phase2=AI評価API連携 / Phase2.5=AIメニュー生成(TSV) / Phase3=Suunto連携 / Phase4=PDCA版(フェーズレポート常駐プロンプト)
**方針：UIを先に詰めてから各種API接続を後半の山場にする**

**[新方針・15章] Suunto取り込みは「生JSONパーサーをサーバー内蔵」で設計**：手動エクスポートJSONも将来のAPI JSONも構造同一。パーサー（server/lib/suunto-parser.js）を純粋関数として作れば、入口（手動→API）を差し替えるだけで再利用でき、変換ロジックを資産化できる。6/7データ取り込みはそのリハーサル。

**[新方針] Suunto取り込みは「生JSONパーサーをサーバー内蔵」で設計（15章）**：手動エクスポートJSONも将来のAPI JSONも構造同一のため、パーサーを一度作れば入口（手動D&D→API）を差し替えるだけで再利用できる。変換ロジックを資産化する。

## 実装済み（Phase1）

Node+Express+SQLite、月ナビ（左寄せ・前月/次月/カレンダーピッカー・起動時最新月）、全列テーブル（固定列・横スクロール・行色分け・🏃💤📝アイコン）、ソート、activity_typeトグル、フリーテキスト検索、インライン編集+SQLite保存+サジェスト、フェーズ管理UI+サマリーバー、AI評価ボタンUI(ダミー)、TSV/Markdownエクスポート、詳細ドロワー(ラップ表示+Chart.jsグラフ)、設定画面。
追加済み：source列、planned_menu列+2段表示、reportsテーブル先行定義、session_type列+自動推測、同日グルーピング表示、距離カンマ小数点バグ修正、HR=bpm/Cadence=spm/Stride計算/↑↓標高/GCB列、ロック機構、ドロワー40vw、背面マスク貫通(pointer-events:none)、シューズ欄フリーテキスト化。
**15章パーサー（リハーサル成功）：server/lib/suunto-parser.js（純粋関数）+ POST /api/import/suunto（data/suunto_raw/スキャン）。6/7の生JSON3本を取り込み済み。/preview・/commitの器は温存。**

## 重要なデータ変換仕様（ハマりどころ）

- 距離：m÷1000=km。**カンマ小数点注意**（'1,2 km'=1.2km、ヨーロッパ式）。当初バグで全距離誤り→修正済
- HR：JSON値(bps)×60=bpm（例2.25→135）。Personal.MaxHR=3.33×60=200
- **Cadence：JSON値(rps)×60×2=spm**（例1.33→160）。当初×2のみで3spm誤り→修正済
- VerticalOscillation：×100=cm（0.09→9.0）。GroundContactTime：×1000=ms。GCB：%そのまま
- **Stride：JSONのStrideは不正確（Lap53で1.16m誤）。正しくは Speed÷(Cadence_rps×2)** →Runalyze一致（0.95m）。修正済
- 標高：ラップは ascent_m / descent_m に分離（下り基調でascent=0,descent=58等）。表示「+0/-58m」
- Duration：'30:59:00'はMM:SS:00形式(=30分59秒,Googleスプレッドシート時刻)、H:MM:SSは1時間超のみ
- Energy：J÷4184=kcal
- VO2maxはラップ単位・時系列に存在しない（セッション全体1値51.7のみ）。ラップ非対応で確定
- **ラップ抽出元＝`DeviceLog.Windows`の`Window.Type=='Autolap'`**（1kmごと＋端数）。`Type=='Activity'`/`'Move'`はセッション全体サマリーで除外。`Lap`イベント(Start/Stop)は別物。100kmウルトラの102ラップもAutolapから生成
- **EPOC→trimp**（整数丸め。例EPOC17.6→trimp18）。見落としやすい
- セッション集計はHeader基準。ただし**cadence_avg_spm/stride_length_cmは全ラップの平均**から算出（Header.Strideは両足ストライドで定義が違うため不使用）。avg_hr_pctはHeaderに平均HRが無いため全ラップのbpm平均を暫定格納（将来単位整理）

## データソース決定

**FITではなくJSON採用**（FITはラップにバイオメカ無し、JSONはラップレベルで全データありRunalyze完全一致）。Lapデータ：DBに保存せずAI評価時にその場取得して全ラップ送信。

## スキーマ（sessions主要列）

id, activity_type(running/rest/manual), session_type(warmup/main/cooldown), source(manual/suunto/ai_generated), suunto_workout_id, phase_id, date, planned_menu(AI提案・上書き不可), menu(実績・手動), memo, locate, shoes, distance_km, duration_s, pace_per_km_s, avg_hr_pct, elevation_m, cadence_score, energy_kcal, title, trimp, vo2max, ground_contact_ms, gcb_left_pct, vertical_oscillation_cm, cadence_max_spm, cadence_avg_spm, stride_length_cm, gc_balance, impression(感想・AI送信必須), claude_eval, claude_eval_at, claude_eval_locked, gpt_eval, gpt_eval_at, gpt_eval_locked, created_at, updated_at
他テーブル：phases, shoes, reports

## 確定したUI/UX設計

- **詳細パネル=ドロワー幅40vw固定**（将来可変は設定画面で・YAGNI）
- **背面マスクは薄く残すが装飾的**：pointer-events:noneで背面テーブルをスクロール・クリック可能に。一覧を見ながら特定セッションを凝視（マスター・ディテール同時閲覧）。別行アイコンクリックで詳細がその日に切替。セオリーの「マスクで背面ブロック」は意図的に不採用
- 月ナビは画面左に配置
- CS列はメインテーブル非表示、バイオ4列(GC/VO/Stride/GCB)常時表示
- **4.5 表示フォーマット規約**：歩幅はm単位・小数点2桁統一（DBはcm保持、表示時m変換）。HR=bpm整数、VO=cm小数1桁、GCB=%小数1桁、Cadence=spm整数等
- **5.5 AI評価ロック機構**：claude_eval_locked/gpt_eval_locked(INTEGER DEFAULT 0)。デフォルト編集可、「確定」ボタンでロック→AIボタン無効化+🔒、「解除」ボタン(確認ダイアログ)で個別解除。一括UIは作らない。インポート時gpt_eval有り行はlocked=1で投入。サーバーもPOST /api/ai/evaluateでロック中403を返す二重ガード
- **9.1 シューズ欄段階的設計**：現状フリーテキスト（既存に長文メモ・表記揺れ・「A or B」混在のため）、将来正規化してプルダウン化(Phase2〜3)
- 予定/実績2カラム：planned_menu(AI提案)とmenu(実績)分離
- 同日複数セッション(WU/メイン/CD)：時計で別々に記録→API移行後も別セッション取得。dateグルーピング表示。AI評価はセッション単位と1日まとめ両方
- AI役割分担：claude_eval=客観コーチ(事実・改善点、褒めない)、gpt_eval=寄り添いコーチ(感情サポート)。既存Z列コメントはgpt_evalへ移行(172件)
- フェーズレポート常駐プロンプト(12章=PDCA核)：md(ロードマップ/振り返り/テーマ/フォーム課題)をreportsテーブルにインポート→有効期間内レポートをAI評価・メニュー生成時に評価軸として自動送信
- AIメニュー生成(11章/Phase2.5)：参照期間データからTSV形式で来月メニュー提案→プレビュー→DB取込。source='ai_generated'

## 成果物（/mnt/user-data/outputs/）

- suunto_design_v4.md：最新設計書(全14章＋4.5/5.5/9.1)。docx版も有
- sample_sessions.json：実Suunto JSON(100kmウルトラ102ラップ)変換。HR=bpm/Cadence=spm/Stride計算済み
- spreadsheet_sessions.json：スプレッドシート(2025-12〜2026-05、280件)変換。running177/rest99/manual4、GPT評価172、バイオ179。カンマ小数点修正済み

## API接続調査（一旦保留）

- Suunto API：apizone.suuntoの現行サイトは「パートナープログラム承認必須」明記。Sign in画面にSign up無し。パートナー申請フォーム https://survey.alchemer.eu/s3/90553908/ （審査2週間・API Agreement署名・商用/公開向け）。個人開放の情報もあったが公式サイトと食い違い
- **Runalyze Personal API**：Supporter課金で利用可能(公式・合法)。元FIT/gpx/tcxエクスポート可、CSVエクスポートも。tokenヘッダー方式。**これが本命**、スクレイピング不要
- 結論：API接続は保留（Runalyze Supporter課金で進行予定）。各種API接続は開発後半の山場

## 既知の問題・将来タスク

- **5/31が2行重複**：スプレッドシート由来「奈良ウルトラマラソン」＋JSON由来「奈良100kmウルトラマラソン」。14章「API値で上書き補正」で将来統合
- 5/2と5/3の数値が同一＝スプレッドシート記入ミス(元データ由来、スキップ確定)
- 残り12件のペース異常値(ウォーキング・超短距離)は元データ由来でそのまま
- VO2maxは元データにほぼ未入力のため空欄が正常
- **[直近の指摘・要対応] 既存GPTコメント(172件)が初期状態で未ロック**。ALTER TABLEでカラム追加したが既定値0のまま。`UPDATE sessions SET gpt_eval_locked=1 WHERE gpt_eval IS NOT NULL AND gpt_eval != '';` を流して既存データを保護する必要あり
- [将来14章] Suunto/Runalyze API取得後、date+近似distance(±10%)でマッチングしてスプレッドシート移行データをAPI正確値で上書き補正(手動列menu/memo/感想/shoes/planned_menu/claude_eval/gpt_eval/phase_idは保持)。マッチング確認UI(差分プレビュー・承認)付き
- UUID永続化：再インポートでIDが変わる問題。URLブックマーク前提なら要修正(詳細ページ化は見送ったため優先度低)

## 直近の状況（このチャット末尾・2026-06-07）

**15章パーサーのリハーサル成功。** server/lib/suunto-parser.js（純粋関数）と POST /api/import/suunto（data/suunto_raw/スキャン方式）をClaude Codeが実装。6/7の生JSON3本（WU/メイン/CD）を本日分として取り込み成功（read:3/inserted:3）。全項目が期待値と一致（dist/pace/HR/cadence/stride/GCT/VO/GCB/trimp/vo2max/laps数）。既存の /preview・/commit は温存済み。設計書15章を「リハーサル完了・実装タスク✅」に更新済み。
- 学び：メインの elevation_m は Header.Ascent=null のため null が正解（0埋めしない）。Claude Codeのパーサーが正しく、当方の期待値表の「0」が誤記だった。設計書15章にAscentのnull許容を明記済み。

## 次のステップ

1. **15章の本番化（Phase3で）**：D&D取り込みUI・プレビュー・重複チェック（date+distance+duration冪等性）。今は /preview・/commit の器だけ温存。入口をSuunto/Runalyze APIに差し替えればパーサーはそのまま再利用
2. **[要対応・優先度低] 既存GPTコメントの初期ロック** UPDATE文（GPTは継続コーチングのメモリが生きているためユーザー判断で後回し可）
3. UI詰め継続候補：5/31重複の手動統合手段、列幅調整、行高さ、フェーズサマリー情報追加、ドロワーのグラフ配置
4. Phase2(AI評価API連携)はAPIキー取得 or Runalyze課金後の後半山場
5. スマホ対応は一旦保留(PC俯瞰が主目的、Suunto公式アプリがスマホにある)
