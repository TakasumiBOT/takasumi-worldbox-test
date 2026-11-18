export const GUILD_REQUESTS_CHANGED_EVENT = "worldbox:guild-requests-changed";
export const GUILD_BOARD_CHANGED_EVENT = "worldbox:guild-board-changed";

export function notifyGuildRequestsChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(GUILD_REQUESTS_CHANGED_EVENT));
  }
}

export function onGuildRequestsChanged(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(GUILD_REQUESTS_CHANGED_EVENT, handler);
  return () => window.removeEventListener(GUILD_REQUESTS_CHANGED_EVENT, handler);
}

export function notifyGuildBoardChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(GUILD_BOARD_CHANGED_EVENT));
  }
}

export function onGuildBoardChanged(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(GUILD_BOARD_CHANGED_EVENT, handler);
  return () => window.removeEventListener(GUILD_BOARD_CHANGED_EVENT, handler);
}
