export const GUILD_PLOT_COUNT = 6;
export const GUILD_PLOT_FEE = 500;
export const GUILD_SHOP_FEE_RATE = 0.05;
export const GUILD_LISTING_MAX = 12;

export const GUILD_PLOT_ANCHORS: readonly { x: number; y: number }[] = [
  { x: 4, y: 51 },
  { x: 9, y: 51 },
  { x: 14, y: 51 },
  { x: 4, y: 57 },
  { x: 9, y: 57 },
  { x: 14, y: 57 },
];

export interface GuildListing {
  id: string;
  sellerKey: string;
  itemId: string;
  count: number;
  sold: number;
  price: number;
}

export interface GuildPlot {
  idx: number;
  guildId: string;
  listings: GuildListing[];
}

export interface GuildShopState {
  plots: (GuildPlot | null)[];
  listingSeq: number;
  feeSeq: number;
}

export function emptyGuildShopState(): GuildShopState {
  return { plots: Array.from({ length: GUILD_PLOT_COUNT }, () => null), listingSeq: 0, feeSeq: 0 };
}

function parseListing(raw: unknown): GuildListing | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  if (typeof v.id !== "string" || typeof v.sellerKey !== "string") return null;
  if (typeof v.itemId !== "string") return null;
  const count = typeof v.count === "number" && Number.isFinite(v.count) ? Math.floor(v.count) : 0;
  const sold = typeof v.sold === "number" && Number.isFinite(v.sold) ? Math.floor(v.sold) : 0;
  const price = typeof v.price === "number" && Number.isFinite(v.price) ? Math.floor(v.price) : 0;
  if (count <= 0 || price <= 0 || sold < 0 || sold > count) return null;
  return { id: v.id, sellerKey: v.sellerKey, itemId: v.itemId, count, sold, price };
}

export function parseGuildShopState(raw: unknown): GuildShopState {
  let data: unknown = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      return emptyGuildShopState();
    }
  }
  const out = emptyGuildShopState();
  if (!data || typeof data !== "object" || Array.isArray(data)) return out;
  const v = data as Record<string, unknown>;
  if (Array.isArray(v.plots)) {
    for (const rawPlot of v.plots) {
      if (!rawPlot || typeof rawPlot !== "object" || Array.isArray(rawPlot)) continue;
      const p = rawPlot as Record<string, unknown>;
      const idx = typeof p.idx === "number" ? Math.floor(p.idx) : -1;
      if (idx < 0 || idx >= GUILD_PLOT_COUNT || typeof p.guildId !== "string") continue;
      const listings = Array.isArray(p.listings)
        ? p.listings.map(parseListing).filter((l): l is GuildListing => l !== null)
        : [];
      out.plots[idx] = { idx, guildId: p.guildId, listings };
    }
  }
  if (typeof v.listingSeq === "number" && Number.isFinite(v.listingSeq))
    out.listingSeq = Math.max(0, Math.floor(v.listingSeq));
  if (typeof v.feeSeq === "number" && Number.isFinite(v.feeSeq))
    out.feeSeq = Math.max(0, Math.floor(v.feeSeq));
  return out;
}

export function listingAvailable(listing: GuildListing): number {
  return Math.max(0, listing.count - listing.sold);
}

export function sellerProceeds(
  price: number,
  count: number,
  feeRate: number = GUILD_SHOP_FEE_RATE,
): number {
  const rate = Number.isFinite(feeRate) ? Math.min(0.9, Math.max(0, feeRate)) : GUILD_SHOP_FEE_RATE;
  return Math.floor(price * count * (1 - rate));
}

export function saleTaxAmount(
  price: number,
  count: number,
  feeRate: number = GUILD_SHOP_FEE_RATE,
): number {
  return Math.max(0, price * count - sellerProceeds(price, count, feeRate));
}

export function plotOfGuild(state: GuildShopState, guildId: string): GuildPlot | null {
  return state.plots.find((p) => p?.guildId === guildId) ?? null;
}

export function findListing(
  state: GuildShopState,
  listingId: string,
): { plot: GuildPlot; listing: GuildListing } | null {
  for (const plot of state.plots) {
    if (!plot) continue;
    const listing = plot.listings.find((l) => l.id === listingId);
    if (listing) return { plot, listing };
  }
  return null;
}
