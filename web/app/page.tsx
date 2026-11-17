import { redirect } from "next/navigation";

// このリポジトリは WORLD BOX 専用なので、ルートはそのままゲームへ飛ばす。
export default function Home() {
  redirect("/games/worldbox");
}
