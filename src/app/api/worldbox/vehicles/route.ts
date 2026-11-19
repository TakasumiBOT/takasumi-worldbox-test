import { NextResponse } from "next/server";
import { getRequestSession, isSameOriginRequest, sessionOwnerKey } from "@/lib/auth";
import { withUserLock } from "@/lib/worldbox/core/user-lock";
import { countItem } from "@/lib/worldbox/player/profile";
import { loadProfile } from "@/lib/worldbox/player/profile-online";
import { VEHICLE_IDS, VEHICLE_SPECS, vehicleSpecFor } from "@/lib/worldbox/player/vehicles";
import { loadEquippedVehicle, storeEquippedVehicle } from "@/lib/worldbox/player/vehicles-online";

export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

function err(error: string, status = 400) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

export async function GET(request: Request) {
  const session = getRequestSession(request);
  if (!session) return err("unauthorized", 401);
  const ownerKey = sessionOwnerKey(session);

  const [equippedVehicle, profile] = await Promise.all([
    loadEquippedVehicle(ownerKey),
    loadProfile(ownerKey),
  ]);

  const ownedVehicles = VEHICLE_IDS.filter((id) => countItem(profile, id) > 0);
  return NextResponse.json(
    {
      equippedVehicle:
        equippedVehicle && ownedVehicles.includes(equippedVehicle) ? equippedVehicle : null,
      ownedVehicles,
      specs: VEHICLE_SPECS,
    },
    { headers: NO_STORE },
  );
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return err("forbidden", 403);
  const session = getRequestSession(request);
  if (!session) return err("unauthorized", 401);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return err("invalid_request", 400);
  }

  const ownerKey = sessionOwnerKey(session);
  return withUserLock(ownerKey, async () => {
    const rawId = body.vehicleId;
    if (!rawId) {
      await storeEquippedVehicle(ownerKey, null);
      return NextResponse.json({ ok: true, equippedVehicle: null }, { headers: NO_STORE });
    }
    const spec = vehicleSpecFor(rawId);
    if (!spec) return err("unknown_vehicle", 400);
    const profile = await loadProfile(ownerKey);
    if (countItem(profile, spec.id) < 1) return err("not_owned", 409);

    await storeEquippedVehicle(ownerKey, spec.id);
    return NextResponse.json({ ok: true, equippedVehicle: spec.id, spec }, { headers: NO_STORE });
  });
}
