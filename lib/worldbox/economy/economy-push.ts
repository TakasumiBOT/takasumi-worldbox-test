export const ECONOMY_APPLIED_EVENT = "worldbox:economy-applied";

export function notifyEconomyApplied(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(ECONOMY_APPLIED_EVENT));
  }
}

export function onEconomyApplied(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(ECONOMY_APPLIED_EVENT, handler);
  return () => window.removeEventListener(ECONOMY_APPLIED_EVENT, handler);
}
