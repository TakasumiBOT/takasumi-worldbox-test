export const GUILD_SHOP_CHANGED_EVENT = "worldbox:guild-shop-changed";

export function notifyGuildShopChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(GUILD_SHOP_CHANGED_EVENT));
  }
}

export function onGuildShopChanged(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(GUILD_SHOP_CHANGED_EVENT, handler);
  return () => window.removeEventListener(GUILD_SHOP_CHANGED_EVENT, handler);
}
