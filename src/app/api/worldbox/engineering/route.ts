import { NextResponse } from "next/server";
import { getRequestSession, isSameOriginRequest, sessionOwnerKey } from "@/lib/auth";
import { itemById, RECIPES, recipeById } from "@/lib/worldbox/economy/items";
import { addItem, countItem, removeItem } from "@/lib/worldbox/player/profile";
import { isProfileEnabled, loadProfile, storeProfile } from "@/lib/worldbox/player/profile-online";
import {
  CUSTOM_CHIPS,
  CUSTOM_CORES,
  CUSTOM_FRAMES,
  CUSTOM_MODULES,
  customBlueprintCost,
  encodeCustomBlueprint,
  isMachineItem,
  MACHINE_SPECS,
  parseCustomBlueprint,
} from "@/lib/worldbox/economy/machines";
import { incrementQuestProgress, pushMmoNews } from "@/lib/worldbox/social/mmo-events-online";
import { withUserLock } from "@/lib/worldbox/core/user-lock";

export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

const TECH_RECIPE_IDS = new Set([
  "copper_wire",
  "steel_plate",
  "circuit_board",
  "microchip",
  "servo_motor",
  "battery_cell",
  "solar_cell",
  "sensor_unit",
  "hydraulic_piston",
  "lockpick",
  "police_cuffs",
  "burner_phone",
  "auto_harvester",
  "auto_planter",
  "auto_miner",
  "cnc_factory",
  "power_generator",
  "smart_vending",
  "security_camera",
  "logistics_sorter",
  "custom_machine",
]);

function err(error: string, status = 400) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

export async function GET(request: Request) {
  const session = getRequestSession(request);
  if (!session) return err("unauthorized", 401);
  if (!isProfileEnabled()) return err("profile_unavailable", 503);
  const ownerKey = sessionOwnerKey(session);
  const profile = await loadProfile(ownerKey);

  const techRecipes = RECIPES.filter((r) => TECH_RECIPE_IDS.has(r.id)).map((r) => ({
    ...r,
    outputItem: itemById(r.output),
    isMachine: isMachineItem(r.output),
  }));

  return NextResponse.json(
    {
      profile,
      recipes: techRecipes,
      machineSpecs: Object.values(MACHINE_SPECS),
      builderParts: {
        frames: CUSTOM_FRAMES,
        cores: CUSTOM_CORES,
        modules: CUSTOM_MODULES,
        chips: CUSTOM_CHIPS,
      },
    },
    { headers: NO_STORE },
  );
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return err("forbidden", 403);
  const session = getRequestSession(request);
  if (!session) return err("unauthorized", 401);
  if (!isProfileEnabled()) return err("profile_unavailable", 503);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return err("invalid_request", 400);
  }
  const fields = (body ?? {}) as Record<string, unknown>;
  const ownerKey = sessionOwnerKey(session);

  return withUserLock(ownerKey, async () => {
    const now = Date.now();
    let profile = await loadProfile(ownerKey);

    if (fields.action === "craft_recipe") {
      const rec = recipeById(fields.recipeId);
      if (!rec || !TECH_RECIPE_IDS.has(rec.id)) return err("invalid_recipe", 400);
      const count =
        typeof fields.count === "number" && Number.isFinite(fields.count)
          ? Math.max(1, Math.min(10, Math.floor(fields.count)))
          : 1;

      for (const [itemId, reqQty] of Object.entries(rec.inputs)) {
        if (countItem(profile, itemId) < reqQty * count) {
          return err("not_enough_items", 409);
        }
      }
      for (const [itemId, reqQty] of Object.entries(rec.inputs)) {
        const next = removeItem(profile, itemId, reqQty * count);
        if (!next) return err("not_enough_items", 409);
        profile = next;
      }
      const totalOut = rec.outputCount * count;
      profile = addItem(profile, rec.output, totalOut);
      const disc = profile.discoveredRecipes ?? [];
      if (!disc.includes(rec.id)) {
        profile = { ...profile, discoveredRecipes: [...disc, rec.id] };
      }
      await storeProfile(ownerKey, profile);
      void incrementQuestProgress(ownerKey, "craft_tech", 1, now);
      if (isMachineItem(rec.output)) {
        const item = itemById(rec.output);
        void pushMmoNews(
          "machine",
          `${session.username || "エンジニア"} が「${item?.name ?? rec.output}」を製造しました！`,
          now,
        );
      }
      return NextResponse.json(
        {
          ok: true,
          profile,
          craftedItem: rec.output,
          craftedCount: totalOut,
        },
        { headers: NO_STORE },
      );
    }

    if (fields.action === "assemble_custom") {
      const bp = parseCustomBlueprint(fields.blueprint);
      const cost = customBlueprintCost(bp);
      for (const [itemId, reqQty] of Object.entries(cost)) {
        if (countItem(profile, itemId) < reqQty) {
          return NextResponse.json(
            { error: "not_enough_items", missing: itemId, needed: reqQty },
            { status: 409, headers: NO_STORE },
          );
        }
      }
      for (const [itemId, reqQty] of Object.entries(cost)) {
        const next = removeItem(profile, itemId, reqQty);
        if (!next) return err("not_enough_items", 409);
        profile = next;
      }
      profile = addItem(profile, "custom_machine", 1);
      const disc = profile.discoveredRecipes ?? [];
      if (!disc.includes("custom_machine")) {
        profile = {
          ...profile,
          discoveredRecipes: [...disc, "custom_machine"],
        };
      }
      await storeProfile(ownerKey, profile);
      const code = encodeCustomBlueprint(bp);
      void incrementQuestProgress(ownerKey, "craft_tech", 1, now);
      void pushMmoNews(
        "machine",
        `${session.username || "設計技師"} がカスタムマシン『${bp.name}』を組み立てました！`,
        now,
      );
      return NextResponse.json(
        {
          ok: true,
          profile,
          blueprint: bp,
          code,
        },
        { headers: NO_STORE },
      );
    }

    return err("invalid_action", 400);
  });
}
