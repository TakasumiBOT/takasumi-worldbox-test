# takasumi-worldbox-test

AGO WORLD BOX の中身だけを本家 [deshihito/BOT](https://github.com/deshihito/BOT) から抽出した移行テスト版。Vercel で本家とは別にもう1個動かすためのコピーで、**本家（AGO BOT / Pi）側は何も消えていない**。

抽出元: deshihito/BOT main `102daef`（PR #1079 マージ時点、2026-11-17。当初 `c301444` / PR #1075 から同期）。内訳と本家との差分は [docs/EXTRACTION.md](docs/EXTRACTION.md) を参照。

## 動かし方（Vercel）

1. Vercel でこのリポジトリを Import し、**Root Directory に `web` を指定する**（Framework Preset は Next.js）。リポジトリ構成は本家のモノレポ（`web/` + `core/`）をそのまま写してある。
2. Neon で専用プロジェクトを作り、接続文字列を `DATABASE_URL` に設定する。スキーマは `web/db/schema.sql` で、ローカルから `cd web && DATABASE_URL=... npm run setup:db` で適用する（冪等なので再実行可）。
3. Environment Variables に `web/.env.example` の項目を設定する。値はすべてこのインスタンス専用に用意する（本家 Pi の値は使わない）。要点: `BOT_API_BASE_URL=https://<このデプロイのドメイン>/botapi`、`BOT_API_KEY=<自前で生成したランダムな秘密>`、`CRON_SECRET=<Vercel Cron 用の秘密>`、専用 Discord OAuth アプリの `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET`。
4. Discord Developer Portal の OAuth2 Redirects に `https://<このデプロイのドメイン>/api/auth/discord/callback` を追加し、`DISCORD_REDIRECT_URI` にも同じ URL を設定する。
5. Deploy。ルート `/` は `/games/worldbox` へリダイレクトする。

## 大事な前提

- **バックエンドは完全に独立**。このアプリ自身が bot-api 互換レイヤ（`web/app/botapi/v1/query`・`/v1/rpc`、実装は `web/lib/botapi-server.ts`）を持ち、その先は専用の Neon Postgres（スキーマは `web/db/schema.sql`）だけに接続する。既存のクライアント（`web/lib/bot-api.ts`）は契約が同じなので無変更で、`BOT_API_BASE_URL` を自ドメインの `/botapi` に向けるだけで自前 DB につながる。許可テーブルは bot_kv / users / transaction_history / economy_pool_state のみ、RPC は経済4本（pay_house / refund_house / add_loss / transfer_coins）のみで、それ以外は fail-closed。経済プールの初期シードは 1,000,000（`schema.sql` 内の要調整パラメータ）。
- **経済オプの回収は Vercel Cron が担う**。旧 Python ワーカー（本家 Bot 側の常駐処理）の役割 — pending オプの回収、失効 claim の再処理、適用台帳が applying のまま止まったオプの終端化 — は `web/app/api/worldbox/internal/economy-sweep` に移植し、`web/vercel.json` の cron で毎分呼ぶ（`CRON_SECRET` で保護、未設定なら何もしない）。適用は Web の直接適用と同じ関数を使う。
- **Phase 1 の割り切り（本家との差分）**: Discord へ送るチャット中継（outbox）は配送先の常駐 Bot がいないため行が溜まるだけになる。Discord サーバー情報のディレクトリも空のまま（ユニオン＝ギルド連携は劣化）。`!wbstate` 等の Bot 側コマンドは対象外。
- **サイト URL と管理者は env 駆動**。`SITE_URL` は `NEXT_PUBLIC_SITE_URL`（未設定時はリクエストのオリジン）で、agobot.app のハードコードは無い。`WORLDBOX_ADMIN_IDS` 未設定なら管理者はいない（AGO 側の管理者 ID の埋め込みフォールバックは削除済み）。
- **リアルタイム中継（WebSocket）は実装済み**。Vercel Functions の WebSocket（2026-10-20 GA、Fluid compute 必須）を使い、`web/app/api/worldbox/realtime/route.ts` がトークン検証→ `upgradeWebSocket()` で受け、接続をインスタンス内ハブ `web/realtime/hub.js` へ渡す。中継ロジック（部屋・タブ世代・移動連続性・プレゼンス集約書き込み・watch 差分配信・ピアノ音）は本家 Pi の `realtime-server.js` と同一配線で、純粋ロジック（relay-core / watch-core）は本家と共有。制約: 接続は Function の最大実行時間（ルートで `maxDuration = 300`、Pro なら800まで可）で切れる — クライアントは自動再接続＋切断中は REST 併送＋再接続時に全再同期を持つので実害は小さい。ハブの状態はインスタンス内に閉じるため、別インスタンスの相手とは bot_kv 経由で同期する（跨げない場合もポーリングへ劣化するだけ）。Fluid compute が有効なプロジェクトであること（2025-04-23 以降に作ったプロジェクトは既定で有効）。
- **アーケード筐体の中身は入っていない**。筐体は表示されるが中は「準備中」になる（`app/games/worldbox/arcade-clients.tsx` のコメント参照）。筐体に入っている26タイトルは AGO 本体のオンラインゲームで、WORLD BOX の中身ではないため。
- `core/` 配下の Python は Bot 本体（Pi）側で動く WORLD BOX の中身のコピー。Vercel では動かない。参照用（テストの一部が TS↔Python の理由ホワイトリスト一致を検証するため、本家と同じ相対配置で置いてある）。

## ローカル確認

```sh
cd web
npm install
npm run build   # 本番ビルド（確認済み: 全ルート生成成功）
npm test        # 944件中939件パス。残りは設計上の既知の失敗3件（下記。集計上はファイル単位の失敗を含み5件と表示される）
node scripts/relay-local-check.mjs   # WS 中継ハブの動作確認（全9項目）
npm run dev     # 開発サーバー（web/.env.local に同じ環境変数を置く）
```

WS 中継のローカル確認について: `upgradeWebSocket()` は Vercel 上（または `vc dev`）でしか動かないため、上記スクリプトは素の ws サーバーでアップグレードだけを肩代わりし、トークン検証以降のハブ配線が本番と同一であることを確かめるもの。アップグレード自体の最終確認は Vercel へデプロイしてからになる。

既知のテスト失敗（3件、いずれも移行の設計どおり）:
- `worldbox-arcade.test.mjs` の2件: 筐体の中身26タイトルと本家の `[id]` 振り分けが無いため。
- `worldbox-shell.test.mjs` の「配線」1件: 本家 Pi のデプロイスクリプト（`deploy/deploy-web.sh`）の存在を前提にするため。Vercel 版には無関係。
