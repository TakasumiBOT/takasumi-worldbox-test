# takasumi-worldbox-test

AGO WORLD BOX の中身だけを本家 [deshihito/BOT](https://github.com/deshihito/BOT) から抽出した移行テスト版。Vercel で本家とは別にもう1個動かすためのコピーで、**本家（AGO BOT / Pi）側は何も消えていない**。

抽出元: deshihito/BOT main `c301444`（PR #1075 マージ時点、2026-11-17）。内訳と本家との差分は [docs/EXTRACTION.md](docs/EXTRACTION.md) を参照。

## 動かし方（Vercel）

1. Vercel でこのリポジトリを Import し、**Root Directory に `web` を指定する**（Framework Preset は Next.js）。リポジトリ構成は本家のモノレポ（`web/` + `core/`）をそのまま写してある。
2. Environment Variables に `web/.env.example` の項目を設定する。値は本家 Pi と同じものを使う。
3. Discord Developer Portal の OAuth2 Redirects に `https://<このデプロイのドメイン>/api/auth/discord/callback` を追加し、`DISCORD_REDIRECT_URI` にも同じ URL を設定する。
4. Deploy。ルート `/` は `/games/worldbox` へリダイレクトする。

## 大事な前提

- **バックエンドは本家と共有**。この Web は状態を持たず、セーブ・経済・プレゼンスの正は全部 Bot 本体の API（`BOT_API_BASE_URL`）の先にある bot_kv / 経済プール。つまり Vercel 版は「同じワールド・同じ経済へのもう1つの入口」で、テスト用に分離されたワールドではない。分離したい場合は bot-api 側で名前空間を分ける必要がある。
- **リアルタイム中継（WebSocket）は Vercel では動かない**。本家では `realtime-server.js` が Next の前段で `/api/worldbox/realtime` を中継しているが、Vercel は常駐サーバーを置けない。クライアントは中継に繋がらない場合 REST ポーリングへ自動で戻る設計（本家の共有ノート参照）なので、プレゼンスはポーリング間隔の滑らかさで遊べる。`realtime/` と `realtime-server.js` は参考として同梱してあるだけで、Vercel では使われない。
- **アーケード筐体の中身は入っていない**。筐体は表示されるが中は「準備中」になる（`app/games/worldbox/arcade-clients.tsx` のコメント参照）。筐体に入っている26タイトルは AGO 本体のオンラインゲームで、WORLD BOX の中身ではないため。
- `core/` 配下の Python は Bot 本体（Pi）側で動く WORLD BOX の中身のコピー。Vercel では動かない。参照用（テストの一部が TS↔Python の理由ホワイトリスト一致を検証するため、本家と同じ相対配置で置いてある）。

## ローカル確認

```sh
cd web
npm install
npm run build   # 本番ビルド（確認済み: 全ルート生成成功）
npm test        # 912件中907件パス。残り3件は設計上の既知の失敗（下記）
npm run dev     # 開発サーバー（web/.env.local に同じ環境変数を置く）
```

既知のテスト失敗（3件、いずれも移行の設計どおり）:
- `worldbox-arcade.test.mjs` の2件: 筐体の中身26タイトルと本家の `[id]` 振り分けが無いため。
- `worldbox-shell.test.mjs` の「配線」1件: 本家 Pi のデプロイスクリプト（`deploy/deploy-web.sh`）の存在を前提にするため。Vercel 版には無関係。
