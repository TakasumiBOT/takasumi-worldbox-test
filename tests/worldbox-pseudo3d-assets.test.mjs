import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const rootDir = path.join(import.meta.dirname, "..");
const libDir = path.join(rootDir, "src/lib");

function transpile(relPath, base = libDir) {
  const src = fs.readFileSync(path.join(base, relPath), "utf8");
  return ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

function stripModuleSyntax(code) {
  const lines = code.split("\n");
  const out = [];
  let skippingImport = false;
  for (const line of lines) {
    if (skippingImport) {
      if (line.includes(";")) skippingImport = false;
      continue;
    }
    if (/^import\s/.test(line)) {
      if (!line.includes(";")) skippingImport = true;
      continue;
    }
    out.push(
      line
        .replace(/^export\s+(?=(const|let|var|function|class)\s)/, "")
        .replace(/^export\s+(?=async\s+function)/, "")
        .replace(/^export\s*\{[^}]*\};?\s*$/, ""),
    );
  }
  return out.join("\n");
}

async function compileTs(files, exportNames) {
  const code =
    files.map((f) => stripModuleSyntax(transpile(f))).join("\n\n") +
    `\nexport { ${exportNames.join(", ")} };\n`;
  return import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
}

const EMOJI_RE =
  /[\u{1F1E0}-\u{1F1FF}\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{231A}-\u{23FA}]/u;

function assertWebpFile(relPath) {
  const full = path.join(rootDir, "public/img/worldbox", relPath);
  assert.ok(fs.existsSync(full), `Missing WebP sprite: ${relPath}`);
  const buf = fs.readFileSync(full);
  assert.ok(buf.length > 64, `WebP sprite too small: ${relPath}`);
  assert.equal(buf.subarray(0, 4).toString("ascii"), "RIFF", `Invalid RIFF header: ${relPath}`);
  assert.equal(buf.subarray(8, 12).toString("ascii"), "WEBP", `Invalid WEBP signature: ${relPath}`);
}

test("pseudo3d: 全カテゴリの WebP アセットが存在し形式が正しい", async () => {
  const vehMod = await compileTs(
    ["worldbox/player/vehicles.ts", "worldbox/world/pseudo3d.ts"],
    [
      "VEHICLE_IDS",
      "VEHICLE_SPRITE_META",
      "HORSE_COAT_SLUGS",
      "BUILDING_KINDS",
      "BUILDING_FACINGS",
      "SURFACE_OBJECT_COLS",
      "WORLD_PROP_COLS",
      "directionIndex16",
      "vectorHeadingDeg",
      "horseSpriteSrcForCoat",
      "computeBuildingDrawRect",
    ],
  );

  for (const vid of vehMod.VEHICLE_IDS) {
    const meta = vehMod.VEHICLE_SPRITE_META[vid];
    assert.ok(meta, `Missing VEHICLE_SPRITE_META for ${vid}`);
    assertWebpFile(meta.dirSheetSrc.replace("/img/worldbox/", ""));
    assertWebpFile(meta.sliceAtlasSrc.replace("/img/worldbox/", ""));
    if (meta.sirenAltSliceAtlasSrc) {
      assertWebpFile(meta.sirenAltSliceAtlasSrc.replace("/img/worldbox/", ""));
    }
  }

  for (const coat of Object.keys(vehMod.HORSE_COAT_SLUGS)) {
    const src = vehMod.horseSpriteSrcForCoat(coat);
    assertWebpFile(src.replace("/img/worldbox/", ""));
  }

  for (const kind of vehMod.BUILDING_KINDS) {
    for (const facing of vehMod.BUILDING_FACINGS) {
      assertWebpFile(`buildings/${kind}_${facing}.webp`);
    }
  }

  assertWebpFile("objects/surface_objects.webp");
  assertWebpFile("objects/world_props.webp");

  // 16-direction heading math checks
  assert.equal(vehMod.directionIndex16(vehMod.vectorHeadingDeg(1, 0)), 0);
  assert.equal(vehMod.directionIndex16(vehMod.vectorHeadingDeg(0, 1)), 4);
  assert.equal(vehMod.directionIndex16(vehMod.vectorHeadingDeg(-1, 0)), 8);
  assert.equal(vehMod.directionIndex16(vehMod.vectorHeadingDeg(0, -1)), 12);

  // Building footprint alignment check (6x4 => 176x172 @ 28px/tile, tile=44)
  const rect = vehMod.computeBuildingDrawRect(100, 200, 264, 176, 44, 176, 172);
  assert.ok(Math.abs(rect.y + rect.h - (200 + 176) - (4 * 44) / 28) < 1e-6);
});

test("pseudo3d: 全 SPECIAL_OBJECTS と STRUCTURES がスプライトマップに網羅されている", async () => {
  const mod = await compileTs(
    [
      "worldbox/core/rng.ts",
      "worldbox/economy/items.ts",
      "worldbox/world/mapgen.ts",
      "worldbox/world/maplogic.ts",
      "worldbox/world/objects.ts",
      "worldbox/world/pseudo3d.ts",
    ],
    ["SPECIAL_OBJECTS", "STRUCTURES", "SURFACE_OBJECT_COLS", "WORLD_PROP_COLS"],
  );

  for (const o of mod.SPECIAL_OBJECTS) {
    if (o.id === "fishing_spot") continue;
    assert.ok(
      Number.isInteger(mod.SURFACE_OBJECT_COLS[o.id]),
      `Missing SURFACE_OBJECT_COLS mapping for ${o.id}`,
    );
  }
  assert.ok(Number.isInteger(mod.SURFACE_OBJECT_COLS.gold_door));

  for (const st of mod.STRUCTURES) {
    assert.ok(
      Number.isInteger(mod.WORLD_PROP_COLS[st.id]),
      `Missing WORLD_PROP_COLS mapping for structure ${st.id}`,
    );
  }
  assert.ok(Number.isInteger(mod.WORLD_PROP_COLS.lamp_day));
  assert.ok(Number.isInteger(mod.WORLD_PROP_COLS.lamp_night));
});

test("pseudo3d: 競馬 horseTrackPose が左右両回りの進行方向角 angleDeg を返し全毛色が存在する", async () => {
  const racing = await compileTs(
    [
      "worldbox/core/rng.ts",
      "worldbox/activity/racing/horses.ts",
      "worldbox/activity/racing.ts",
      "worldbox/world/pseudo3d.ts",
    ],
    ["COAT_COLORS", "HORSE_COAT_SLUGS", "generateRaceCore", "horseTrackPose"],
  );

  for (const coat of Object.keys(racing.COAT_COLORS)) {
    assert.ok(racing.HORSE_COAT_SLUGS[coat], `Missing horse coat slug for ${coat}`);
  }

  const track = { cx: 93, cy: 26, rx: 29, ry: 18, innerRx: 24, innerRy: 13 };
  const coreLeft = {
    ...racing.generateRaceCore(1_800_000_000_000),
    track: { id: "t1", name: "L", direction: "左", small: false },
  };
  const coreRight = { ...coreLeft, track: { id: "t2", name: "R", direction: "右", small: false } };

  for (const core of [coreLeft, coreRight]) {
    const h = core.entries[0].horse.id;
    const p1 = racing.horseTrackPose(core, h, 0.25, track);
    const p2 = racing.horseTrackPose(core, h, 0.26, track);
    assert.ok(Number.isFinite(p1.angleDeg) && p1.angleDeg >= 0 && p1.angleDeg < 360);
    const moveDeg = ((Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180) / Math.PI + 360) % 360;
    const diff = Math.abs(((p1.angleDeg - moveDeg + 540) % 360) - 180);
    assert.ok(
      diff < 12,
      `angleDeg=${p1.angleDeg} diverged from velocity=${moveDeg} (diff=${diff})`,
    );
  }
});

test("pseudo3d: presence と relay が有効な vehicle を同期し不正値を除去する", async () => {
  const pres = await compileTs(
    ["worldbox/world/mapgen.ts", "worldbox/player/presence.ts"],
    ["sanitizeHeartbeat", "parsePresenceEntry"],
  );
  const relay = await import("../src/realtime/relay-core.js");
  const bounds = { minX: -1000, maxX: 1000, minY: -1000, maxY: 1000 };

  const hbValid = pres.sanitizeHeartbeat(
    { name: "t", x: 10, y: 20, vx: 1, vy: 0, face: 1, space: "world", vehicle: "police_cruiser" },
    bounds,
  );
  assert.equal(hbValid.vehicle, "police_cruiser");

  const hbInvalid = pres.sanitizeHeartbeat(
    { name: "t", x: 10, y: 20, vx: 1, vy: 0, face: 1, space: "world", vehicle: "ufo_999" },
    bounds,
  );
  assert.equal(hbInvalid.vehicle, undefined);

  const parsed = pres.parsePresenceEntry("p1", { ...hbValid, ts: Date.now() });
  assert.equal(parsed.vehicle, "police_cruiser");

  const rValid = relay.sanitizeHeartbeat({
    x: 10,
    y: 20,
    vx: 1,
    vy: 0,
    face: 1,
    space: "world",
    vehicle: "cargo_truck",
  });
  assert.equal(rValid.vehicle, "cargo_truck");

  const rInvalid = relay.sanitizeHeartbeat({
    x: 10,
    y: 20,
    vx: 1,
    vy: 0,
    face: 1,
    space: "world",
    vehicle: "<script>",
  });
  assert.equal(rInvalid.vehicle, undefined);
});

test("pseudo3d: 変更・新規ファイルに Unicode 絵文字が含まれない", () => {
  for (const rel of [
    "src/lib/worldbox/world/pseudo3d.ts",
    "src/lib/worldbox/world/textures.ts",
    "src/lib/worldbox/player/presence.ts",
    "src/lib/worldbox/activity/racing.ts",
    "src/app/games/worldbox/VehiclePseudo3DViewer.tsx",
    "src/app/games/worldbox/WorldBoxDealerPanel.tsx",
    "src/app/games/worldbox/WorldBoxClient.tsx",
    "src/realtime/relay-core.js",
  ]) {
    const src = fs.readFileSync(path.join(rootDir, rel), "utf8");
    assert.equal(EMOJI_RE.test(src), false, `Found prohibited Unicode emoji in ${rel}`);
  }
});
