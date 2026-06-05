# Claude Code 設定

## コミット・プッシュ
- コミット後は必ず `git push origin main` でプッシュする
- コミットメッセージは**日本語**で書く
- 1行目：変更の要約（例：「Phase 1: テーブル列を設計書に合わせて修正」）
- 必要に応じて本文に詳細を記載

## 作業ログ
- コミット時は **`docs/worklog.md`** に作業内容を追記する
- フォーマット：`## YYYY-MM-DD — 変更内容タイトル` セクションを追加

## プロジェクト概要
Suunto ランニング記録アプリ。設計書: `docs/suunto_design_v4.md`

## 起動
```bash
npm start        # サーバー起動 → http://localhost:3000
node server/scripts/import_spreadsheet.js --clean  # 初回データ投入
```
