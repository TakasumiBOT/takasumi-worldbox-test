import type { ReactNode } from "react";
import { discordClientId } from "@/lib/auth";
import GamesShell from "./GamesShell";

export default function GamesLayout({ children }: { children: ReactNode }) {
  // Application ID は公開情報（OAuth の client_id）。シークレットは渡さない。
  // Discord アクティビティとしての初期化は GamesShell（クライアント側）が行う。
  return <GamesShell clientId={discordClientId()}>{children}</GamesShell>;
}
