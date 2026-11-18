import { NextResponse } from "next/server";
import { getRequestSession, publicOrigin, sessionOwnerKey } from "@/lib/auth";
import type { CoinMovement } from "@/lib/worldbox/economy/economy";
import { buildEconomyOp } from "@/lib/worldbox/economy/economy-bridge";
import {
  enqueueEconomyOpOnce,
  findEconomyOp,
  isEconomyEnabled,
  readUserBalance,
  waitForOpDone,
} from "@/lib/worldbox/economy/economy-bridge-online";
import { withUserLock } from "@/lib/worldbox/core/user-lock";
import { loadNationsState } from "@/lib/worldbox/social/nations-online";
import { isProfileEnabled, loadProfile, storeProfile } from "@/lib/worldbox/player/profile-online";
import {
  cancelRequest,
  fulfillRequest,
  postRequest,
  requestsForGuild,
} from "@/lib/worldbox/social/requests";
import {
  isRequestsEnabled,
  loadRequestsState,
  storeRequestsState,
} from "@/lib/worldbox/social/requests-online";
import { loadMyLobbyStation } from "@/lib/worldbox/world/station-online";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

const BAD_REQUEST_ERRORS = new Set([
  "invalid_request",
  "invalid_action",
  "unknown_item",
  "invalid_count",
  "invalid_reward",
]);
const FORBIDDEN_ERRORS = new Set(["not_poster", "wrong_guild", "self_fulfill"]);

function errorResponse(error: string) {
  const status = BAD_REQUEST_ERRORS.has(error) ? 400 : FORBIDDEN_ERRORS.has(error) ? 403 : 409;
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

function statusError(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === publicOrigin(request);
}

function view(state: Parameters<typeof requestsForGuild>[0], guildId: string, ownerKey: string) {
  return requestsForGuild(state, guildId).map((r) => ({ ...r, mine: r.posterKey === ownerKey }));
}

async function escrowStatus(
  posterKey: string,
  requestId: string,
): Promise<"done" | "pending" | "failed"> {
  const op = await findEconomyOp(posterKey, `escrow-${requestId}`);
  if (!op) return "failed";
  return op.status;
}

async function enqueueCoin(
  ownerKey: string,
  discordId: string,
  coin: CoinMovement,
  opId: string,
): Promise<boolean> {
  const op = buildEconomyOp(
    { kind: coin.kind, userKey: ownerKey, discordId, amount: coin.amount, reason: coin.reason },
    opId,
    Date.now(),
  );
  if (!op) return false;
  return enqueueEconomyOpOnce(op);
}

export async function GET(request: Request) {
  const session = getRequestSession(request);
  if (!session || !isRequestsEnabled()) {
    return NextResponse.json({ loggedIn: false, me: null, requests: [] }, { headers: NO_STORE });
  }
  const ownerKey = sessionOwnerKey(session);
  const [nations, state] = await Promise.all([loadNationsState(), loadRequestsState()]);
  const mine = nations.members[ownerKey];
  if (!mine) {
    return NextResponse.json({ loggedIn: true, me: null, requests: [] }, { headers: NO_STORE });
  }
  const nation = nations.nations[mine.nationId];
  return NextResponse.json(
    {
      loggedIn: true,
      me: {
        guildId: mine.nationId,
        guildName: nation?.name ?? "",
        role: mine.role,
      },
      requests: view(state, mine.nationId, ownerKey),
    },
    { headers: NO_STORE },
  );
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return statusError("forbidden", 403);
  const session = getRequestSession(request);
  if (!session) return statusError("unauthorized", 401);
  if (session.provider !== "discord") return statusError("discord_required", 403);
  if (!isRequestsEnabled() || !isProfileEnabled()) return statusError("requests_unavailable", 503);
  if (!isEconomyEnabled()) return statusError("economy_unavailable", 503);
  return withUserLock("worldbox:requests", () => handlePost(request, session));
}

type AuthedSession = NonNullable<ReturnType<typeof getRequestSession>>;

async function handlePost(request: Request, session: AuthedSession) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return statusError("invalid_request", 400);
  }
  const data = (body ?? {}) as {
    action?: unknown;
    itemId?: unknown;
    count?: unknown;
    reward?: unknown;
    requestId?: unknown;
  };
  const ownerKey = sessionOwnerKey(session);
  const discordId = session.id;

  const nations = await loadNationsState();
  const mine = nations.members[ownerKey];
  if (!mine) return errorResponse("not_in_nation");
  const guildId = mine.nationId;
  if ((await loadMyLobbyStation(ownerKey)) !== "guild") {
    return errorResponse("not_at_guild_board");
  }

  const state = await loadRequestsState();

  switch (data.action) {
    case "post": {
      const balance = await readUserBalance(discordId);
      if (balance === null) return statusError("economy_unavailable", 503);
      const requestId = crypto.randomUUID();
      const result = postRequest(
        state,
        {
          id: requestId,
          guildId,
          posterKey: ownerKey,
          posterName: session.username,
          itemId: data.itemId,
          count: data.count,
          reward: data.reward,
          now: Date.now(),
        },
        balance,
      );
      if (!result.ok) return errorResponse(result.error);
      if (!(await storeRequestsState(result.state))) return statusError("store_failed", 503);
      if (!(await enqueueCoin(ownerKey, discordId, result.coin, `escrow-${requestId}`))) {
        await storeRequestsState(state);
        return statusError("economy_failed", 503);
      }
      return NextResponse.json(
        { requests: view(result.state, guildId, ownerKey), request: result.request },
        { headers: NO_STORE },
      );
    }
    case "fulfill": {
      if (typeof data.requestId !== "string") return statusError("invalid_request", 400);
      const target = state.requests[data.requestId];
      if (!target) return errorResponse("not_found");
      const esc = await escrowStatus(target.posterKey, data.requestId);
      if (esc === "pending") return errorResponse("escrow_pending");
      if (esc === "failed") return errorResponse("escrow_failed");
      const [fulfillerProfile, posterProfile] = await Promise.all([
        loadProfile(ownerKey),
        loadProfile(target.posterKey),
      ]);
      const result = fulfillRequest(
        state,
        data.requestId,
        guildId,
        ownerKey,
        fulfillerProfile,
        posterProfile,
      );
      if (!result.ok) return errorResponse(result.error);
      if (!(await storeProfile(ownerKey, result.fulfillerProfile))) {
        return statusError("store_failed", 503);
      }
      if (!(await storeProfile(result.request.posterKey, result.posterProfile))) {
        await storeProfile(ownerKey, fulfillerProfile);
        return statusError("store_failed", 503);
      }
      if (!(await storeRequestsState(result.state))) {
        await storeProfile(ownerKey, fulfillerProfile);
        await storeProfile(result.request.posterKey, posterProfile);
        return statusError("store_failed", 503);
      }
      if (!(await enqueueCoin(ownerKey, discordId, result.coin, `reward-${data.requestId}`))) {
        await storeProfile(ownerKey, fulfillerProfile);
        await storeProfile(result.request.posterKey, posterProfile);
        await storeRequestsState(state);
        return statusError("economy_failed", 503);
      }
      const settled = await waitForOpDone(ownerKey, `reward-${data.requestId}`);
      if (settled && settled.status === "failed") {
        await storeProfile(ownerKey, fulfillerProfile);
        await storeProfile(result.request.posterKey, posterProfile);
        await storeRequestsState(state);
        return NextResponse.json(
          { error: "economy_failed", opError: settled.error ?? null },
          { status: 409, headers: NO_STORE },
        );
      }
      return NextResponse.json(
        {
          requests: view(result.state, guildId, ownerKey),
          profile: result.fulfillerProfile,
          request: result.request,
        },
        { headers: NO_STORE },
      );
    }
    case "cancel": {
      if (typeof data.requestId !== "string") return statusError("invalid_request", 400);
      const result = cancelRequest(state, data.requestId, ownerKey);
      if (!result.ok) return errorResponse(result.error);
      const esc = await escrowStatus(ownerKey, data.requestId);
      if (esc === "pending") return errorResponse("escrow_pending");
      if (!(await storeRequestsState(result.state))) return statusError("store_failed", 503);
      if (esc === "done") {
        if (!(await enqueueCoin(ownerKey, discordId, result.coin, `refund-${data.requestId}`))) {
          await storeRequestsState(state);
          return statusError("economy_failed", 503);
        }
        const refundSettled = await waitForOpDone(ownerKey, `refund-${data.requestId}`);
        if (refundSettled && refundSettled.status === "failed") {
          await storeRequestsState(state);
          return NextResponse.json(
            { error: "economy_failed", opError: refundSettled.error ?? null },
            { status: 409, headers: NO_STORE },
          );
        }
      }
      return NextResponse.json(
        { requests: view(result.state, guildId, ownerKey) },
        { headers: NO_STORE },
      );
    }
    default:
      return statusError("invalid_action", 400);
  }
}
