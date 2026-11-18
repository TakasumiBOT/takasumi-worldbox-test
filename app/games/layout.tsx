import type { ReactNode } from "react";
import { discordClientId } from "@/lib/auth";
import GamesShell from "./GamesShell";

export default function GamesLayout({ children }: { children: ReactNode }) {
  return <GamesShell clientId={discordClientId()}>{children}</GamesShell>;
}
