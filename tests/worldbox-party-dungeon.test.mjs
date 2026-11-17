// WORLD BOX バッチ5: パーティ編成とダンジョン生成の純粋ロジックテスト。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const rootDir = path.join(import.meta.dirname, "..");
const libDir = path.join(rootDir, "lib");

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
        .replace(/^export\s+(?=(const|let|var|function|class)\s)/, "")
        .replace(/^export\s+(?=async\s+function)/, "")
        .replace(/^export\s*\{[^}]*\};?\s*$/, ""),
    );
  }
  return out.join("\n");
}

function dataUrl(js) {
  return "data:text/javascript;base64," + Buffer.from(js).toString("base64");
}

async function loadBundle(files, exportNames) {
  const code =
    files.map((name) => stripModuleSyntax(transpile(name))).join("\n") +
    `\nexport { ${exportNames.join(", ")} };\n`;
  return import(dataUrl(code));
}

const T = await loadBundle(
  [
    "worldbox/core/rng.ts",
    "worldbox/world/mapgen.ts",
    "worldbox/world/lobby.ts",
    "worldbox/economy/items.ts",
    "worldbox/world/objects.ts",
    "worldbox/world/instances.ts",
    "worldbox/social/party.ts",
  ],
  [
    "buildDungeonFloor",
    "DUNGEON_FLOORS",
    "createParty",
    "joinParty",
    "leaveParty",
    "addInvite",
    "inviteFor",
    "parseParty",
    "partyKeyOf",
    "MAX_PARTY_MEMBERS",
    "PARTY_INVITE_TTL_MS",
  ],
);

const member = (ownerKey, role = "free", rank = 1) => ({ ownerKey, name: ownerKey, role, rank });

test("party: create holds leader and entrance", () => {
  const p = T.createParty("p1", member("discord:1", "blade", 2), { x: 10, y: 20 }, 1000);
  assert.equal(p.leaderKey, "discord:1");
  assert.equal(p.members.length, 1);
  assert.deepEqual(p.entrance, { x: 10, y: 20 });
  assert.equal(T.partyKeyOf(p, "discord:1"), "p1");
  assert.equal(T.partyKeyOf(null, "discord:9"), "solo:discord:9");
});

test("party: join up to 4, reject 5th and duplicates", () => {
  let p = T.createParty("p1", member("discord:1"), { x: 0, y: 0 }, 0);
  const join = (party, m) => {
    const r = T.joinParty(party, m);
    return "party" in r ? r.party : party;
  };
  p = join(p, member("discord:2"));
  p = join(p, member("discord:3"));
  p = join(p, member("discord:4"));
  assert.equal(p.members.length, T.MAX_PARTY_MEMBERS);
  assert.equal(T.joinParty(p, member("discord:5")).error, "full");
  assert.equal(T.joinParty(p, member("discord:2")).error, "already_member");
});

test("party: leader leaving disbands, member leaving keeps party", () => {
  let p = T.createParty("p1", member("discord:1"), { x: 0, y: 0 }, 0);
  p = T.joinParty(p, member("discord:2")).party;
  const after = T.leaveParty(p, "discord:2");
  assert.equal(after?.members.length, 1);
  assert.equal(T.leaveParty(p, "discord:1"), null);
  assert.equal(T.leaveParty(p, "discord:99")?.members.length, 2);
});

test("party: invite expires by TTL", () => {
  let p = T.createParty("p1", member("discord:1"), { x: 0, y: 0 }, 1000);
  p = T.addInvite(p, { toKey: "discord:2", name: "discord:2", at: 1000 });
  assert.ok(T.inviteFor(p, "discord:2", 1000 + T.PARTY_INVITE_TTL_MS - 1));
  assert.equal(T.inviteFor(p, "discord:2", 1000 + T.PARTY_INVITE_TTL_MS + 1), null);
  assert.equal(T.inviteFor(p, "discord:3", 1000), null);
});

test("party: parse roundtrip and junk rejection", () => {
  let p = T.createParty("p1", member("discord:1", "guard", 3), { x: -5, y: 7 }, 42);
  p = T.joinParty(p, member("discord:2", "scout", 1)).party;
  p = T.addInvite(p, { toKey: "discord:3", name: "discord:3", at: 42 });
  const back = T.parseParty(JSON.parse(JSON.stringify(p)));
  assert.deepEqual(back, p);
  assert.equal(T.parseParty(null), null);
  assert.equal(T.parseParty({ id: "x" }), null);
  assert.equal(T.parseParty("nope"), null);
});

test("dungeon: deterministic per entrance, differs across entrances", () => {
  const a = T.buildDungeonFloor(1234, 10, 20, 0);
  const b = T.buildDungeonFloor(1234, 10, 20, 0);
  assert.deepEqual(a, b);
  const c = T.buildDungeonFloor(1234, 11, 20, 0);
  assert.notDeepEqual(
    { chests: a.chests, portal: a.portal, stairsDown: a.stairsDown },
    { chests: c.chests, portal: c.portal, stairsDown: c.stairsDown },
  );
  assert.equal("mobs" in a, false, "ダンジョンにモブは湧かない");
});

test("dungeon: every floor has portal, stairs rules and chests (no mobs, no doors)", () => {
  for (let layer = 0; layer < T.DUNGEON_FLOORS; layer++) {
    const f = T.buildDungeonFloor(777, 3, 4, layer);
    assert.equal(f.floor, layer + 1);
    assert.equal("mobs" in f, false);
    assert.equal("boss" in f, false);
    assert.equal("doors" in f, false);
    assert.ok(f.portal.x >= 0 && f.portal.y >= 0);
    if (layer < T.DUNGEON_FLOORS - 1) {
      assert.ok(f.stairsDown, `floor ${layer + 1} stairs`);
      assert.ok(
        f.chests.every((c) => !c.main),
        `floor ${layer + 1} main chest is final-floor only`,
      );
    } else {
      assert.equal(f.stairsDown, null);
      // 最深層は主宝箱がちょうど1つ（クリア条件）
      assert.equal(f.chests.filter((c) => c.main).length, 1);
      assert.equal(f.chests.length, 1);
    }
  }
});

test("dungeon: tiles are inside the 52x52 bounds and blocked covers walls", () => {
  const f = T.buildDungeonFloor(5, 0, 0, 3);
  for (const c of f.chests) {
    assert.ok(c.x >= 0 && c.x < 52 && c.y >= 0 && c.y < 52);
    // 固体はオブジェクト（宝箱）だけ。壁は moveMap 側で塞ぐ
    assert.ok(f.data.blocked.has(`${c.x},${c.y}`));
  }
  assert.equal(f.data.blocked.has(`${f.portal.x},${f.portal.y}`), false);
});
