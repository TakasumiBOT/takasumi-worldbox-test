import type { WorldBoxState } from "./save";

export type InitialSaveChoice = {
  state: WorldBoxState | null;
  source: "online" | "local" | "new";
  pushLocalToOnline: boolean;
};

export function chooseInitialSave(
  online: WorldBoxState | null,
  local: WorldBoxState | null,
  loggedIn: boolean,
): InitialSaveChoice {
  if (loggedIn && online) return { state: online, source: "online", pushLocalToOnline: false };
  if (local) return { state: local, source: "local", pushLocalToOnline: loggedIn };
  return { state: null, source: "new", pushLocalToOnline: false };
}
