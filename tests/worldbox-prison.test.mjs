import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const rootDir = path.join(import.meta.dirname, "..");
const libDir = path.join(rootDir, "src/lib");

function transpile(name, base = libDir) {
  const src = fs.readFileSync(path.join(base, name), "utf8");
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
        .replace(/^export\s+(?=(const|let|var|function|class|async\s+function)\s)/, "")
        .replace(/^export\s*\{[^}]*\};?\s*$/, ""),
    );
  }
  return out.join("\n");
}

async function loadBundle(files, names) {
  const code =
    files.map((name) => stripModuleSyntax(transpile(name))).join("\n") +
    `\nexport { ${names.join(", ")} };\n`;
  return import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
}

const P = await loadBundle(
  [
    "worldbox/world/mapgen.ts",
    "worldbox/world/lobby.ts",
    "worldbox/world/prison-map.ts",
    "worldbox/social/prison.ts",
  ],
  [
    "PRISON_W",
    "PRISON_H",
    "PRISON_CELLS",
    "PRISON_VISITOR_ENTRY",
    "buildPrison",
    "prisonTileAt",
    "prisonCellEntry",
    "isSolidLobbyTile",
    "stationNear",
    "CRIMES",
    "PRISON_LABOR_TASKS",
    "defaultPrisonRecord",
    "parsePrisonRecord",
    "sentencePlayer",
    "releasePrisoner",
    "remainingBailAmount",
    "isActivelyJailed",
    "dailyNpcSuspects",
  ],
);

test("prison map: 44x32の全通路・独房・作業場・脱獄換気口が歩行到達可能", () => {
  const prison = P.buildPrison();
  assert.equal(prison.width, 44);
  assert.equal(prison.height, 32);

  // Start BFS from visitor entrance
  const startX = Math.floor(P.PRISON_VISITOR_ENTRY.x);
  const startY = Math.floor(P.PRISON_VISITOR_ENTRY.y);
  const isPassable = (x, y) => {
    const t = P.prisonTileAt(prison.tiles, x, y);
    if (P.isSolidLobbyTile(t)) return false;
    return !prison.blocked.has(`${x},${y}`);
  };
  assert.ok(isPassable(startX, startY), "Visitor spawn must be passable");

  const visited = new Set([`${startX},${startY}`]);
  const q = [[startX, startY]];
  while (q.length > 0) {
    const [cx, cy] = q.shift();
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = cx + dx;
      const ny = cy + dy;
      const k = `${nx},${ny}`;
      if (visited.has(k)) continue;
      if (!isPassable(nx, ny)) continue;
      visited.add(k);
      q.push([nx, ny]);
    }
  }

  for (const cell of P.PRISON_CELLS) {
    const cx = Math.floor(cell.x);
    const cy = Math.floor(cell.y);
    assert.ok(visited.has(`${cx},${cy}`), `Cell ${cell.id} (${cx},${cy}) is unreachable`);
  }

  // Every station must be detectable from a reachable tile
  const foundStations = new Set();
  for (const posKey of visited) {
    const [tx, ty] = posKey.split(",").map(Number);
    const st = P.stationNear(prison.objects, tx, ty);
    if (st) foundStations.add(st);
  }
  for (const needed of ["prison_work", "prison_desk", "prison_visit", "prison_escape"]) {
    assert.ok(foundStations.has(needed), `Missing reachable station: ${needed}`);
  }
});

test("prison domain: 逮捕・収監・保釈(弁護士割引)・釈放の計算が正確", () => {
  const now = 1_700_000_000_000;
  const fresh = P.defaultPrisonRecord("discord:123", "テスト市民");
  assert.equal(P.isActivelyJailed(fresh, now), false);

  const jailed = P.sentencePlayer(fresh, {
    code: "vault_heist",
    label: "銀行強盗",
    sentenceMs: 180_000,
    bailAmount: 5000,
    arrestedBy: "警察",
    now,
  });
  assert.equal(P.isActivelyJailed(jailed, now), true);
  assert.equal(jailed.releaseAt, now + 180_000);
  const fullBail = P.remainingBailAmount(jailed, now, false);
  const lawyerBail = P.remainingBailAmount(jailed, now, true);
  assert.equal(fullBail, 5000);
  assert.equal(lawyerBail, 3750);

  const halfBail = P.remainingBailAmount(jailed, now + 90_000, false);
  assert.equal(halfBail, 2500);

  const released = P.releasePrisoner(jailed);
  assert.equal(P.isActivelyJailed(released, now), false);
  assert.equal(released.bailAmount, 0);

  const round = P.parsePrisonRecord(JSON.stringify(jailed), "discord:123");
  assert.equal(round.status, "jailed");
  assert.equal(round.charges[0].label, "銀行強盗");

  assert.ok(P.dailyNpcSuspects(now).length >= 3);
});

test("prison integration: space, relay, API route, panel, client are wired", () => {
  const relay = fs.readFileSync(path.join(rootDir, "src/realtime/relay-core.js"), "utf8");
  assert.match(relay, /prison:\s*\{\s*width:\s*44,\s*height:\s*32\s*\}/);

  const route = fs.readFileSync(path.join(rootDir, "src/app/api/worldbox/prison/route.ts"), "utf8");
  for (const act of [
    "visit_prison",
    "leave_prison",
    "prison_labor",
    "pay_bail",
    "care_package",
    "jailbreak",
    "commit_crime",
    "arrest_player",
    "arrest_npc",
  ]) {
    assert.ok(route.includes(act), `prison route missing ${act}`);
  }
  const client = fs.readFileSync(
    path.join(rootDir, "src/app/games/worldbox/WorldBoxClient.tsx"),
    "utf8",
  );
  assert.match(client, /WorldBoxPrisonPanel/);
  assert.match(client, /buildPrison/);
  assert.match(client, /prison_escape/);
});
