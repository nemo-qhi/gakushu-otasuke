# 受験伴走システム

Phase 0 は、実教材・認証・Google Sheets 接続へ進む前に、自動スケジューラを純粋関数として検証する試作です。

## 実装済み

- 架空教材、架空週間テンプレート、例外予定を使ったスケジューラ入力
- `planStudy(input)` による今日以降の課題配分
- 完了済み、実行中、ロック済み課題を移動しない扱い
- 学習枠の `mobile` / `desk` / `either` 適合
- ハード停止時刻による学習枠の切り詰め
- 教材範囲の重複配分防止
- 最低、標準、追加の閾値
- 実施量からの達成段階判定
- 絶対時刻差によるタイマー経過時間計算
- Phase 0 の結果を確認する簡易画面
- 教材追加フォーム
- 生活時間としての学習枠追加フォーム
- ソフト終了、ハード停止時刻の画面内変更
- 入力内容の端末内保存
- 個人コードの新規生成、既存コードでの読込、D1への同期
- 個人コードはDBへ直接保存せず、ハッシュ化して保存

## 主要ファイル

- `lib/scheduler.mjs`: スケジューラ本体
- `lib/sampleData.mjs`: Phase 0 の架空データ
- `tests/scheduler.test.mjs`: 不変条件テスト
- `app/StudyPlannerApp.tsx`: スケジューラ結果と入力画面
- `app/api/device/create/route.ts`: 個人コード作成API
- `app/api/device/open/route.ts`: 既存コード読込API
- `app/api/sync/route.ts`: 変更同期API
- `lib/sync-store.ts`: D1同期ストア
- `drizzle/0000_personal_code_sync.sql`: 同期用テーブル

## 個人コード同期

初回利用時は「はじめて使う」から個人コードを生成します。別端末では「既に使っている」に同じ個人コードを入れると、同じ学習データを開けます。

同期の正本は Cloudflare D1 です。ブラウザ内には作業用キャッシュを持ちます。スプレッドシート同期はこの構成では使いません。

## テスト

```bash
npm test
```

この環境では npm が利用できない場合、Node.js で直接実行できます。

```bash
node tests/scheduler.test.mjs
```

まとめて確認する場合:

```bash
npm run check
```

## GitHubで試験運用する場合

このリポジトリには2つの試用入口があります。

1. GitHub Pages向けの静的プレビュー
   - `docs/index.html`
   - サーバー不要で開けます。
   - 教材追加、生活時間追加、端末内保存、再計算を試せます。
   - 個人コード同期は使えません。

2. D1付きの本命アプリ
   - `app/` と `app/api/`
   - 個人コード作成、既存コード読込、同期を試せます。
   - Cloudflare D1 / Sites など、D1 binding `DB` が使えるデプロイ先が必要です。

GitHub Pagesを使う場合は、GitHubのPages設定で source を `main` branch の `/docs` にしてください。

公開してよいもの:

- `.env.example`
- `docs/index.html`
- `drizzle/0000_personal_code_sync.sql`

公開してはいけないもの:

- `.env`
- Googleや外部サービスの秘密鍵
- 個人コードの実物
- 本番利用中のデータベースダンプ

## Phase 1 へ進む前の確認事項

- ホーム画面アイコンの見た目
- 1冊目として縦切り検証に使う教材
- 実際の平日、休日、部活動、通学、就寝、ハード停止時刻
- 実績ログの競合解決をどこまで細かく行うか
- タイマー中の Wake Lock を初期状態で有効にするか

## iPhone 実機確認チェックリスト

- ホーム画面から standalone 表示で起動できる
- ノッチ、Dynamic Island、ホームインジケータへ UI が重ならない
- 入力欄の文字サイズが 16px 以上で、意図しないズームが起きない
- タップ領域が 44px 相当以上ある
- タイマー開始後に画面ロックしても、復帰時に絶対時刻から正しい経過時間になる
- オフライン記録が消えたように見えず、復帰後に一度だけ同期される
