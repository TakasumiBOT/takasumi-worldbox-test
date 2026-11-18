import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ログイン | TAKASUMI WORLD BOX",
};

const ERROR_MESSAGES: Record<string, string> = {
  discord_not_configured: "Discord ログインはまだ有効化されていません。",
  google_not_configured: "Google ログインはまだ有効化されていません。",
  discord_denied: "ログインがキャンセルされました。",
  google_denied: "ログインがキャンセルされました。",
  discord_callback_failed: "ログイン処理に失敗しました。もう一度お試しください。",
  google_callback_failed: "ログイン処理に失敗しました。もう一度お試しください。",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const message =
    (error && ERROR_MESSAGES[error]) || "ログインできませんでした。もう一度お試しください.";

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0b0e13",
        color: "#e6edf3",
        padding: "24px",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "380px",
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          gap: "20px",
          alignItems: "center",
        }}
      >
        <h1 style={{ fontSize: "20px", fontWeight: 700, margin: 0 }}>TAKASUMI WORLD BOX</h1>
        <p style={{ fontSize: "14px", lineHeight: 1.7, color: "#c8d2dc", margin: 0 }}>{message}</p>
        <a
          href="/games/worldbox"
          style={{
            display: "inline-block",
            padding: "12px 28px",
            borderRadius: "10px",
            background: "#1f6feb",
            color: "#ffffff",
            fontSize: "14px",
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          WORLD BOX へ戻る
        </a>
      </div>
    </main>
  );
}
