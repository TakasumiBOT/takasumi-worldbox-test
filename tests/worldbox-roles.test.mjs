// WORLD BOX 冒険役職の純粋ロジックテスト。
// Phase 1 以降、この世界に戦闘技は存在しない。技はテレポーターの
// ポーター設置（porter）だけで、activeSkillFor は全役職で null を返す。
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

const R = await loadBundle(
  [
    "worldbox/media/fx.ts",
    "worldbox/economy/items.ts",
    "worldbox/player/profile.ts",
    "worldbox/player/roles.ts",
  ],
  [
    "ADVENTURE_ROLES",
    "SKILLS",
    "MASTERY_THRESHOLDS",
    "rankForXp",
    "masteryRankOf",
    "addMasteryXp",
    "activeSkillFor",
    "skillCooldownLeft",
    "isAdventureRoleId",
    "parseProfile",
    "serializeProfile",
    "SKILL_FX_DURATION_MS",
    "skillFxProgress",
    "skillFxStage",
  ],
);

function profileWith(role, xp = 0) {
  const p = R.parseProfile(null);
  p.role = role;
  if (role !== "free") p.mastery[role] = { xp };
  return p;
}

test("rank thresholds", () => {
  assert.equal(R.rankForXp(0), 1);
  assert.equal(R.rankForXp(29), 1);
  assert.equal(R.rankForXp(30), 2);
  assert.equal(R.rankForXp(80), 3);
  assert.equal(R.rankForXp(160), 4);
  assert.equal(R.rankForXp(300), 5);
  assert.equal(R.rankForXp(99999), 5);
});

test("skills: 技は porter だけ（戦闘技は存在しない）", () => {
  assert.deepEqual(Object.keys(R.SKILLS), ["porter"]);
  assert.equal(R.SKILLS.porter.fx, "warp");
  assert.equal(R.SKILLS.porter.minRank, 1);
  assert.ok(R.SKILL_FX_DURATION_MS.warp > 0);
});

test("activeSkillFor: 全役職で null（porter は設置専用で戦闘技として返さない）", () => {
  for (const role of ["blade", "guard", "scout", "miner", "medic", "teleporter", "free"]) {
    assert.equal(R.activeSkillFor(profileWith(role, 0)), null, role);
    assert.equal(R.activeSkillFor(profileWith(role, 300)), null, `${role} rank5`);
  }
});

test("mastery persists per role across switches", () => {
  let p = profileWith("blade", 0);
  p = R.addMasteryXp(p, "blade", 35).profile;
  assert.equal(R.masteryRankOf(p, "blade"), 2);
  p = { ...p, role: "miner" };
  assert.equal(R.masteryRankOf(p, "miner"), 1);
  p = { ...p, role: "blade" };
  assert.equal(R.masteryRankOf(p, "blade"), 2);
});

test("cooldown is computed from skillAt", () => {
  const now = 1_000_000;
  let p = profileWith("teleporter", 0);
  assert.equal(R.skillCooldownLeft(p, "porter", now), 0);
  p = { ...p, skillAt: { porter: now } };
  assert.equal(R.skillCooldownLeft(p, "porter", now + 1000), R.SKILLS.porter.cooldownMs - 1000);
  assert.equal(R.skillCooldownLeft(p, "porter", now + R.SKILLS.porter.cooldownMs), 0);
});

test("profile roundtrip keeps role fields（死亡系フィールドは落ちる）", () => {
  let p = profileWith("scout", 45);
  p = {
    ...p,
    skillAt: { porter: 123 },
    tauntUntil: 456,
    reviveMark: { space: "cave:1,2:1", at: 789 },
    pendingTeleport: { space: "world", x: 3.5, y: 4.5 },
  };
  const back = R.parseProfile(R.serializeProfile(p));
  assert.equal(back.role, "scout");
  assert.equal(back.mastery.scout?.xp, 45);
  assert.equal(back.skillAt.porter, 123);
  assert.equal("tauntUntil" in back, false);
  assert.equal("reviveMark" in back, false);
  assert.deepEqual(back.pendingTeleport, { space: "world", x: 3.5, y: 4.5 });
});

test("legacy profile defaults to free role", () => {
  const back = R.parseProfile(JSON.stringify({ items: {}, hotbar: [], storage: [], hunger: 80 }));
  assert.equal(back.role, "free");
  assert.deepEqual(back.mastery, {});
  assert.equal(R.masteryRankOf(back, "blade"), 1);
  assert.equal(back.pendingTeleport, null);
});

test("skill fx stages: warp は導入→本体の2段", () => {
  const eff = { kind: "warp", x: 0, y: 0, fromX: 0, fromY: 0, startedAt: 1000, seed: 7 };
  assert.equal(R.skillFxStage(eff, 1000), 0);
  assert.equal(R.skillFxStage(eff, 1000 + R.SKILL_FX_DURATION_MS.warp * 0.5), 1);
  assert.ok(R.skillFxProgress(eff, 1000 + R.SKILL_FX_DURATION_MS.warp) >= 1);
});

test("role ids validated", () => {
  assert.equal(R.isAdventureRoleId("blade"), true);
  assert.equal(R.isAdventureRoleId("free"), true);
  assert.equal(R.isAdventureRoleId("king"), false);
  assert.equal(R.isAdventureRoleId(42), false);
});

test("roles route: 蘇生アクションは無く、技は porter 設置のみ", () => {
  const route = fs.readFileSync(path.join(rootDir, "app/api/worldbox/roles/route.ts"), "utf8");
  assert.ok(!route.includes('"revive"'), "蘇生が残っている");
  assert.ok(route.includes('fields.action === "skill"'));
  assert.ok(route.includes('skillId === "porter"'), "porter 以外の技がある");
  assert.ok(route.includes("storePorter"), "ポーター保存が配線されていない");
});
