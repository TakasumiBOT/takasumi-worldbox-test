import { connection } from "next/server";
import { upgradeWebSocket } from "@vercel/functions";
import { getHub } from "@/realtime/hub.js";

// WORLD BOX リアルタイム中継（Vercel Functions の WebSocket、2026-10-20 GA）。
// 本家 Pi では realtime-server.js が Next の前段でこのパスを受けている。
// ここではルートハンドラがトークン検証をしてからアップグレードし、
// 接続をインスタンス内ハブ（realtime/hub.js）へ渡す。中継のロジックは
// 本家と同一（relay-core.js / watch-core.js を共有）。
//
// 制約（Vercel の仕様）:
// - 接続はこの Function の最大実行時間で切れる。Hobby は最大300秒、
//   Pro は800まで上げられる。クライアントは自動再接続＋切断中は REST
//   ハートビート併送＋再接続時に全再同期を持つため、切断は劣化で済む。
// - ハブの状態はインスタンス内に閉じる。別インスタンスへ再接続した相手とは
//   bot_kv 経由（REST ポーリング / watch の poke）で同期する。
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  await connection();
  const hub = getHub();
  const auth = hub.verifyAuth(new URL(request.url).searchParams);
  if (!auth) {
    return new Response("Unauthorized", { status: 401 });
  }
  return upgradeWebSocket(
    (ws) => {
      // upgradeWebSocket の ws は ws パッケージ互換。ハブの要求形に合わせて渡す。
      hub.handleConnection(ws as Parameters<typeof hub.handleConnection>[0], auth);
    },
    // 本家の WebSocketServer と同じ上限（ハートビートとピアノ音だけが流れる）
    { maxPayload: 4096 },
  );
}
