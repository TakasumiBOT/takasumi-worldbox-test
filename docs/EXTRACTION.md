# 抽出メモ（2026-11-17）

抽出元: deshihito/BOT main `c301444`（Merge PR #1075）。本家側は無変更（コピーであり移行＝削除ではない）。

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
- `package.json`: 依存は閉包が実際に使うものだけ（next / react / react-dom / @discord/embedded-app-sdk / ws）。本家の prebuild（計算ワーカー生成・背景透過モデル取得）は WORLD BOX と無関係なので外した。

## 検証結果（2026-11-17、移行時）

- `npm run build` 成功: `/games/worldbox` と API 36ルート＋認証7ルートが生成される。
- 起動スモーク: `/` → 307 で `/games/worldbox`、ページ 200、画像（mobs/slime.png）200、環境変数未設定時の API は 500 で落ちず `presence_unavailable` の JSON を返す。
- `npm test`: 912件中907件パス。失敗3件は設計どおり（アーケード筐体の中身×2、本家 Pi のデプロイスクリプト前提×1）。詳細は README 参照。

## 本家との振る舞いの差分

1. アーケード筐体の中身（オンラインゲーム26タイトル）が無い → 筐体は「準備中」表示。理由は `arcade-clients.tsx` のコメント参照。
2. WebSocket 中継が未実装 → プレゼンスは REST ポーリングにフォールバック（本家でも中継停止時は同じ動き）。Vercel Functions の WebSocket は 2026-10-20 に GA したので移植は可能（Fluid compute 必須、接続は最大実行時間で切れる・インスタンス跨ぎの配信は外部 pub/sub が必要、の2制約つき）。経緯と方針は README の「大事な前提」参照。
3. サイト本体（ホーム、他のゲーム、ダッシュボード等）は無い。`/games/worldbox` と `/api/worldbox/*`、認証ルートだけのアプリ。
