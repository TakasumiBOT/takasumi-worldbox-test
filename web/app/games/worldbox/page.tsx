import WorldBoxClient from "./WorldBoxClient";

// 本家では app/games/[id]/page.tsx がカタログの slug で振り分けて
// worldbox のときだけ <WorldBoxClient /> を返していた（独立シェルのため
// 詳細ヘッダーは出さない）。移行版では専用ルートとして直接置く。
export default function WorldBoxPage() {
  return <WorldBoxClient />;
}
