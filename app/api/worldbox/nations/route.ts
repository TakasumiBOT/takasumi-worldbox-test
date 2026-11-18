import { NextResponse } from "next/server";
import { getRequestSession, publicOrigin, sessionOwnerKey } from "@/lib/auth";
import { worldTileSource } from "@/lib/worldbox/world/mapgen";
import {
  applyFound,
  applyJoin,
  applyLeave,
  buildNationsResponse,
  fastTravelDestination,
  nationViews,
  type MyGuildView,
  type NationActionResult,
  type NationsState,
} from "@/lib/worldbox/social/nations";
import {
  isNationsEnabled,
  loadNationsState,
  storeNationsState,
} from "@/lib/worldbox/social/nations-online";
import { loadMyLobbyStation } from "@/lib/worldbox/world/station-online";
import { parseSave, serializeSave } from "@/lib/worldbox/core/save";
import { loadWorldBoxSave, storeWorldBoxSave } from "@/lib/worldbox/core/save-online";
import { putPresence } from "@/lib/worldbox/player/presence-online";
import {
  annotateMyGuilds,
  getUserGuilds,
  roleInGuild,
  type UserGuildsResult,
} from "@/lib/worldbox/social/guilds";
import {
  isNationHiddenFrom,
  isPrivateNation,
  memberKeysOf,
  resolveMemberRole,
} from "@/lib/worldbox/social/nation-settings";
import {
  loadNationSettings,
  loadNationSettingsMap,
} from "@/lib/worldbox/social/nation-settings-online";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

const FORBIDDEN_ERRORS = new Set(["not_owner", "not_member"]);
const BAD_REQUEST_ERRORS = new Set(["invalid_action", "invalid_request"]);

function errorStatus(error: string): number {
  if (FORBIDDEN_ERRORS.has(error)) return 403;
  return BAD_REQUEST_ERRORS.has(error) ? 400 : 409;
}

function errorResponse(error: string, status?: number) {
  return NextResponse.json({ error }, { status: status ?? errorStatus(error), headers: NO_STORE });
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === publicOrigin(request);
}

function guildsErrorResponse(result: Extract<UserGuildsResult, { ok: false }>) {
  if (result.error === "guilds_scope_required") return errorResponse("guilds_scope_required", 409);
  return errorResponse("guilds_unavailable", 503);
}

export async function GET(request: Request) {
  if (!isNationsEnabled()) {
    return NextResponse.json({ error: "nations_unavailable" }, { status: 503, headers: NO_STORE });
  }
  const session = getRequestSession(request);
  let state = await loadNationsState();
  const selfKey = session ? sessionOwnerKey(session) : null;

  let myGuilds: MyGuildView[] = [];
  let guildsScopeRequired = false;
  if (session && selfKey) {
    const result = await getUserGuilds(session);
    if (result.ok) {
      myGuilds = annotateMyGuilds(result.guilds, state);
      const mine = state.members[selfKey];
      const myGuild = mine ? result.guilds.find((g) => g.id === mine.nationId) : undefined;
      if (mine && myGuild) {
        const role = roleInGuild(myGuild);
        if (role !== mine.role) {
          state = {
            ...state,
            members: { ...state.members, [selfKey]: { nationId: mine.nationId, role } },
          } satisfies NationsState;
          await storeNationsState(state);
          myGuilds = annotateMyGuilds(result.guilds, state);
        }
      }
    } else if (result.error === "guilds_scope_required") {
      guildsScopeRequired = true;
    }
  }
  const response = buildNationsResponse(state, selfKey, { myGuilds, guildsScopeRequired });
  const settingsMap = await loadNationSettingsMap();
  const myMembership = selfKey ? state.members[selfKey] : undefined;
  response.nations = response.nations.filter(
    (n) =>
      !isNationHiddenFrom(settingsMap.get(n.guildId), n.guildId, myMembership?.nationId ?? null),
  );
  if (selfKey && myMembership && response.me) {
    const myNation = state.nations[myMembership.nationId];
    const resolved = myNation
      ? resolveMemberRole(
          myNation,
          settingsMap.get(myMembership.nationId),
          selfKey,
          myMembership.role,
          memberKeysOf(state, myMembership.nationId),
        )
      : null;
    if (resolved) response.me = { nationId: myMembership.nationId, role: resolved.role };
  }
  return NextResponse.json(response, { headers: NO_STORE });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });
  }
  const session = getRequestSession(request);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  if (!isNationsEnabled()) {
    return NextResponse.json({ error: "nations_unavailable" }, { status: 503, headers: NO_STORE });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400, headers: NO_STORE });
  }
  const action = (body as { action?: unknown } | null)?.action;
  const ownerKey = sessionOwnerKey(session);
  const fields = body as { guildId?: unknown };
  if (action !== "travel" && (await loadMyLobbyStation(ownerKey)) !== "guild") {
    return errorResponse("not_at_guild_board");
  }
  const state = await loadNationsState();

  if (action === "travel") {
    const dest = fastTravelDestination(state, ownerKey, worldTileSource());
    if (!dest.ok) return errorResponse(dest.error);
    const prev = parseSave(await loadWorldBoxSave(ownerKey));
    await storeWorldBoxSave(
      ownerKey,
      serializeSave({
        space: "world",
        x: dest.x,
        y: dest.y,
        worldReturn: prev?.worldReturn ?? null,
      }),
    );
    await putPresence(
      ownerKey,
      {
        name: session.username?.trim() || "プレイヤー",
        x: dest.x,
        y: dest.y,
        vx: 0,
        vy: 0,
        face: 1,
        space: "world",
      },
      Date.now(),
    );
    return NextResponse.json(
      { ok: true, x: dest.x, y: dest.y, nationId: dest.nationId },
      { headers: NO_STORE },
    );
  }

  let result: NationActionResult;
  if (action === "found" || action === "join") {
    if (typeof fields.guildId !== "string" || !/^\d+$/.test(fields.guildId)) {
      return errorResponse("invalid_request");
    }
    const guilds = await getUserGuilds(session);
    if (!guilds.ok) return guildsErrorResponse(guilds);
    const guild = guilds.guilds.find((g) => g.id === fields.guildId);
    if (action === "found") {
      if (!guild || !guild.owner) return errorResponse("not_owner");
      result = applyFound(state, ownerKey, guild, worldTileSource(), Date.now());
    } else {
      if (!guild) return errorResponse("not_member");
      if (isPrivateNation(await loadNationSettings(fields.guildId))) {
        return errorResponse("nation_private");
      }
      result = applyJoin(state, ownerKey, fields.guildId, roleInGuild(guild));
    }
  } else if (action === "leave") {
    result = applyLeave(state, ownerKey);
  } else {
    return NextResponse.json({ error: "invalid_action" }, { status: 400, headers: NO_STORE });
  }

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: errorStatus(result.error), headers: NO_STORE },
    );
  }
  const stored = await storeNationsState(result.state);
  if (!stored) {
    return NextResponse.json({ error: "nations_failed" }, { status: 500, headers: NO_STORE });
  }
  const view = result.nation
    ? (nationViews(result.state).find((v) => v.id === result.nation!.guildId) ?? null)
    : null;
  return NextResponse.json(
    {
      ok: true,
      me: buildNationsResponse(result.state, ownerKey).me,
      nation: view,
      disbanded: result.disbanded ?? false,
    },
    { headers: NO_STORE },
  );
}
