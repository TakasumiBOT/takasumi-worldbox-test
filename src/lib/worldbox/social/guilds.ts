import { isBotApiConfigured, kvGet, kvSet } from "../../bot-api";
import { fetchDiscordGuilds, loadWebSession } from "../../dashboard";
import { sessionOwnerKey, type SessionInfo } from "../../auth";
import type { OAuthGuild } from "../../dashboard-core";
import type { MyGuildView, NationRole, NationsState } from "./nations";

export const WORLDBOX_AUTH_NAMESPACE = "worldbox_auth";
export const GUILD_CACHE_TTL_MS = 5 * 60 * 1000;

export type UserGuild = Pick<OAuthGuild, "id" | "name" | "owner" | "permissions">;

const ADMINISTRATOR_BIT = 1n << 3n;

export function roleInGuild(guild: { owner: boolean; permissions: string }): NationRole {
  if (guild.owner) return "king";
  try {
    return (BigInt(guild.permissions) & ADMINISTRATOR_BIT) !== 0n ? "minister" : "citizen";
  } catch {
    return "citizen";
  }
}

export function annotateMyGuilds(guilds: UserGuild[], state: NationsState): MyGuildView[] {
  return guilds.map((g) => ({
    guildId: g.id,
    name: g.name,
    owner: g.owner,
    hasNation: Boolean(state.nations[g.id]),
    myRole: roleInGuild(g),
  }));
}

type GuildCache = { fetchedAt: number; guilds: UserGuild[] };

function asUserGuild(raw: unknown): UserGuild | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  if (typeof v.id !== "string" || v.id.length === 0) return null;
  if (typeof v.name !== "string") return null;
  if (typeof v.permissions !== "string") return null;
  return { id: v.id, name: v.name, owner: v.owner === true, permissions: v.permissions };
}

export function parseGuildCache(raw: unknown, now: number): UserGuild[] | null {
  let data: unknown = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const v = data as Record<string, unknown>;
  if (typeof v.fetchedAt !== "number" || !Number.isFinite(v.fetchedAt)) return null;
  if (now - v.fetchedAt < 0 || now - v.fetchedAt >= GUILD_CACHE_TTL_MS) return null;
  if (!Array.isArray(v.guilds)) return null;
  const guilds: UserGuild[] = [];
  for (const item of v.guilds) {
    const guild = asUserGuild(item);
    if (!guild) return null;
    guilds.push(guild);
  }
  return guilds;
}

export type UserGuildsResult =
  | { ok: true; guilds: UserGuild[] }
  | { ok: false; error: "guilds_scope_required" | "guilds_unavailable" };

export async function getUserGuilds(session: SessionInfo): Promise<UserGuildsResult> {
  if (session.provider !== "discord" || !session.sid || !isBotApiConfigured()) {
    return { ok: false, error: "guilds_scope_required" };
  }
  const cacheKey = sessionOwnerKey(session);
  try {
    const cached = parseGuildCache(await kvGet(WORLDBOX_AUTH_NAMESPACE, cacheKey), Date.now());
    if (cached) return { ok: true, guilds: cached };
  } catch {
    // キャッシュが読めなくても本体の取得は続ける
  }
  const record = await loadWebSession(session.sid);
  if (!record || record.user_id !== session.id) {
    return { ok: false, error: "guilds_scope_required" };
  }
  const fetched = await fetchDiscordGuilds(record.access_token);
  if (!fetched) return { ok: false, error: "guilds_unavailable" };
  const guilds: UserGuild[] = fetched.map((g) => ({
    id: g.id,
    name: g.name,
    owner: g.owner,
    permissions: g.permissions,
  }));
  const cache: GuildCache = { fetchedAt: Date.now(), guilds };
  try {
    await kvSet(WORLDBOX_AUTH_NAMESPACE, cacheKey, JSON.stringify(cache));
  } catch {
    // キャッシュ保存の失敗は致命的ではない（次回また取得する）
  }
  return { ok: true, guilds };
}
