# takasumi-worldbox-test

Takasumi 版 WORLD BOX。共有ワールドを歩き、採集・生産・会社経営・株式取引を行うオンラインゲーム。

稼働先: https://takasumi-worldbox-test.vercel.app （デプロイ済み・稼働中）。ルート `/` は `/games/worldbox` へリダイレクトする。

## ゲーム内容

- 戦闘・モブは無い。採集と生産（製造）が中心。
- 会社システム: 設立（資本金 100,000 以上＋設立税 20%）、招待コードでの入社、時給（JST 8時〜20時に毎時支給、所得税 15%）、商品の出品・販売（作成税 15%／販売税 50%）、法人税（3時間ごと）。
- 株式: 架空 10 銘柄の売買（売却税 10%）と日次配当。プレイヤーの会社は上場しない。
- ゲスト入場あり（「ゲストで入る」）。ゲストはコイン経済（残高・送金・売買など）を使えない。
- アーケード筐体は表示のみで、中身は準備中。

## 構成

- Next.js アプリをリポジトリルート直下に置くフラット構成（`app/`・`lib/`・`realtime/`・`public/`）。
- DB は Neon Postgres。必須の環境変数は `DATABASE_URL` のみ。スキーマは `db/schema.sql`、適用は `npm run setup:db`（冪等）。経済プールの初期シードは 1,000,000。
- bot-api 互換レイヤ（`lib/botapi-server.ts`）を同一プロセスに内蔵し、内部の呼び出しは HTTP を介さず直接ハンドラを呼ぶ。`BOT_API_BASE_URL` / `BOT_API_KEY` は不要。公開ルート `/botapi/v1/query`・`/botapi/v1/rpc` は残るが、キーが env に無い場合は公開リクエストを常に 401 で拒否する（fail-closed）。許可テーブルと経済 RPC 4本（pay_house / refund_house / add_loss / transfer_coins）以外は受け付けない。
- 定期処理（経済スイープ、会社の時給・法人税、株式の配当）は Vercel Cron ではなく、通常の API アクセスに相乗りする遅延実行（`lib/worldbox/core/lazy-jobs.ts`）が主経路で、`CRON_SECRET` は不要。Cron 用の内部ルートも併存し、秘密を設定すれば従来どおり動く。
- リアルタイム中継は WebSocket（`app/api/worldbox/realtime/route.ts`）。接続は Function の最大実行時間（300秒）で切れるため、クライアントは自動再接続し、切断中は REST 併送で継続する。状態の正は bot_kv。

## Discord ログイン

OAuth の設定は `lib/deploy-config.ts` に置く（環境変数があれば env が優先）。Client ID と Redirect URI は設定済みで、Client Secret のみ記入待ち（記入されるまで Discord ログインは成立しない。ゲスト入場は可能）。

## ローカル確認

```sh
npm install
npm run build
npm test
node scripts/relay-local-check.mjs   # WS 中継ハブの動作確認
npm run dev
```

テストは 859 件中 854 件パス。残り 5 件は設計上の既知失敗（アーケード筐体の中身が無いことによるもの、デプロイ用スクリプトの存在を前提にする配線確認など、この構成では成立しない前提のもの）。

## 制限

- Discord へ送るチャット中継は行わない（配送先の常駐 Bot がいないため）。
- Discord サーバーのディレクトリは空で、ギルド連携の一部機能は未対応。
