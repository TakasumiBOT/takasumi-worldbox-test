// デプロイ設定のリポジトリ内蔵フォールバック（サーバー専用）。
//
// 背景: このデプロイ（Vercel プロジェクト）は GitHub リポジトリしか
// 触れない運用のため、Vercel の環境変数が設定できない。そこで Discord
// OAuth の設定は「環境変数があればそちらを優先し、無ければこのファイルの
// 値を使う」二段構えにする（解決順は lib/auth.ts の discord* 関数が正）。
//
// ⚠ 注意（値を記入する前に必ず読むこと）:
// - discordClientSecret に秘密を書くと、**このリポジトリを閲覧できる
//   全員がその秘密を読める**。Git の履歴にも残り続ける。
// - それでも成立するのは「テスト用 Discord アプリ限定」という前提が
//   あるため。本番用のアプリや他サービスと共有する秘密は絶対に
//   ここへ書かないこと。
// - Vercel の環境変数（DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET /
//   DISCORD_REDIRECT_URI）が設定されれば、そちらが常に優先され、
//   このファイルの値は使われなくなる。
// - discordClientId と discordRedirectUri は公開情報（認可 URL に
//   そのまま現れる）なので、書いても秘密にはならない。
export const DEPLOY_CONFIG = {
  /** Discord OAuth アプリの Client ID（未記入なら空文字）。 */
  discordClientId: "",
  /** Discord OAuth アプリの Client Secret（未記入なら空文字）。 */
  discordClientSecret: "",
  /** Discord Developer Portal の Redirects に登録した URL と完全一致させる。 */
  discordRedirectUri: "https://takasumi-worldbox-test.vercel.app/api/auth/discord/callback",
} as const;
