# 抽出メモ（2026-11-17）

抽出元: deshihito/BOT main `c301444`（Merge PR #1075）で初回抽出、その後 `102daef`（Merge PR #1079）まで同期（差分9ファイル＋テスト6ファイル: 望遠鏡の広場追加・ダブルタップ食・ピアノ・タイル個体値ほか）。本家側は無変更（コピーであり移行＝削除ではない）。

## 持ち込んだもの（依存の閉包で機械的に確定）

WORLD BOX の種ファイル（`web/lib/worldbox`、`web/app/games/worldbox`、`web/app/api/worldbox`、認証ルート）から import を辿った閉包は 172 ファイルで、不足 import はゼロだった。

- `lib/worldbox/`（104ファイル）そのまま
- `app/games/worldbox/`、`app/api/worldbox/`（ルート36本）そのまま
- 認証: `app/api/auth/`（Discord / Google / me / logout）、`app/api/activity/games-auth/`
- 共通基盤（WORLD BOX の外への依存はこれだけ）: `lib/auth.ts`、`lib/activity-auth.ts`、`lib/bot-api.ts`、`lib/dashboard.ts`、`lib/dashboard-core.ts`、`lib/discord-activity.ts`、`lib/discord-activity-client.ts`、`lib/games-catalog.ts`、`lib/games/blackjack.ts`（カジノ用）、`lib/poll-guard.ts`、`lib/sfx.ts`、`lib/site.ts`、`lib/subdomain.ts`、`app/games/GamesShell.tsx`、`app/games/layout.tsx`、`app/globals.css`
- 画像: `public/img/worldbox/`（439ファイル）＋ `public/img/nomal.png`（アバター代替）＋ `public/img/jinrou.png`（テクスチャ参照）
- `realtime/`（botkv.js / relay-core.js / watch-core.js）と `realtime-server.js`（Vercel では未使用、参考同梱）
- テスト: 本家 `web/tests/worldbox-*.test.mjs`（85ファイル）
- Python 側: `core/support/worldbox/`、`core/general/circulation/worldbox_*.py`（参照用コピー。本家と同じ相対配置にしてあるので、TS↔Python の整合を検証するテストが無修正で通る）
- リポジトリ全体の形も本家のモノレポ（`web/` + `core/`）を写した。Vercel では Root Directory に `web` を指定する。
- `docs/world-box-shared.md` は本家の共有ノートのスナップショット。以後の決定は本家側が正。

## 新規に書いたもの（移行のための最小差分）

- `app/games/worldbox/page.tsx`: 本家は `app/games/[id]` が slug で振り分けていた。専用ルートとして `<WorldBoxClient />` を直接返す。
- `app/layout.tsx`: サイトクローム無しの最小レイアウト（WORLD BOX は独立シェルで完結する）。
- `app/page.tsx`: `/` → `/games/worldbox` リダイレクト。
- `next.config.mjs`: 本家から `output: "standalone"` と `outputFileTracingRoot` を除去（Vercel 用）。frame-ancestors ヘッダーは同一。
- `package.json`: 依存は閉包が実際に使うものだけ（next / react / react-dom / @discord/embedded-app-sdk / ws / @vercel/functions）。本家の prebuild（計算ワーカー生成・背景透過モデル取得）は WORLD BOX と無関係なので外した。
- WS 中継の Vercel 移植（2026-11-17 追加）: `web/app/api/worldbox/realtime/route.ts`（トークン検証→ `upgradeWebSocket()`、`maxDuration = 300`、`maxPayload = 4096` で本家と一致）と `web/realtime/hub.js`（本家 `realtime-server.js` の接続配線をインスタンス内ハブ化: 状態はモジュール内シングルトン、タイマーは接続の有無で起動/停止、HTTP プロキシとアップグレード処理だけが本家との違い）。検証用に `web/scripts/relay-local-check.mjs`（素の ws でアップグレードを肩代わりし、401 / snap / up / bye / 空間移動 / ピアノ音 / 切断 bye / ハブの後始末の9項目を確認）。

## 検証結果（2026-11-17、移行時＋WS 移植時）

- `npm run build` 成功: `/games/worldbox` と API 37ルート（worldbox 36＋realtime 中継）＋認証7ルートが生成される。
- 起動スモーク: `/` → 307 で `/games/worldbox`、ページ 200、画像（mobs/slime.png）200、環境変数未設定時の API は 500 で落ちず `presence_unavailable` の JSON を返す。
- `npm test`: 930件中925件パス。失敗3件は設計どおり（アーケード筐体の中身×2、本家 Pi のデプロイスクリプト前提×1）。詳細は README 参照。
- WS 中継: `node scripts/relay-local-check.mjs` 全9項目パス。ただし `upgradeWebSocket()` 自体は Vercel 上でしか動かないため、アップグレードの最終確認はデプロイ後（クライアントの接続ログ / 中継経由のプレゼンスで判る）。

## 本家との振る舞いの差分

1. アーケード筐体の中身（オンラインゲーム26タイトル）が無い → 筐体は「準備中」表示。理由は `arcade-clients.tsx` のコメント参照。
2. WebSocket 中継は Vercel 移植済み（上記）。本家との違いは「常駐1プロセス」→「インスタンス内ハブ」の点だけ: 接続が Function の最大実行時間（300秒）で切れる（クライアントの自動再接続で吸収）、別インスタンスの相手へは WS で直接届かず bot_kv 経由になる。ピアノ音は同一インスタンス・同一ロビー内でのみ共有される。
3. サイト本体（ホーム、他のゲーム、ダッシュボード等）は無い。`/games/worldbox` と `/api/worldbox/*`、認証ルートだけのアプリ。
