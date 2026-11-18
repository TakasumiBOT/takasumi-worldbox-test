import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const rootDir = path.join(import.meta.dirname, "..");
const libDir = path.join(rootDir, "lib");
const require = createRequire(import.meta.url);
const watch = require(path.join(rootDir, "realtime", "watch-core.js"));

function transpile(name, base = libDir) {
  const src = fs.readFileSync(path.join(base, name), "utf8");
  return ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
function dataUrl(js) {
  return "data:text/javascript;base64," + Buffer.from(js).toString("base64");
}
function read(rel) {
  return fs.readFileSync(path.join(rootDir, rel), "utf8");
}

test("guild-shop: GET の view が mine を返し、生キーは出ない", () => {
  const routeSrc = read("app/api/worldbox/guild-shop/route.ts");
  assert.match(routeSrc, /mine: l\.sellerKey === viewerKey/);
  assert.match(routeSrc, /view\(state, nations, ownerKey\)/);
  assert.match(routeSrc, /view\(pruned, nations, ownerKey\)/);
  const viewBlock = routeSrc.slice(
    routeSrc.indexOf("function view("),
    routeSrc.indexOf("/** 国家設定込み"),
  );
  assert.ok(!viewBlock.includes("sellerKey: l.sellerKey"), "view が sellerKey を漏らしている");
});

test("guild-shop: パネルの「下げる」条件がサーバーの unlist 権限と一致する", () => {
  const routeSrc = read("app/api/worldbox/guild-shop/route.ts");
  assert.match(routeSrc, /const mine = found\.listing\.sellerKey === ownerKey;/);
  assert.match(routeSrc, /const leaderOfPlot = myGuild === found\.plot\.guildId && isLeader;/);
  const panelSrc = read("app/games/worldbox/WorldBoxGuildShopPanel.tsx");
  assert.match(panelSrc, /\(sel\.mine \|\| \(isLeader && shop\.myGuildId === plot\.guildId\)\)/);
  assert.ok(!panelSrc.includes("|| true"), "常時真の条件が残っている");
});

test("guild-shop watch: WATCH_PLAN に guildShop（worldbox_guild_shop・poke）が入る", () => {
  const plan = watch.WATCH_PLAN.find((p) => p.kind === "guildShop");
  assert.ok(plan, "guildShop の watch が無い");
  assert.equal(plan.namespace, "worldbox_guild_shop");
});

test("guild-shop watch: relay が sync guildShop を流し、クライアントが取り直して地図に描く", () => {
  const serverSrc = read("realtime-server.js");
  assert.match(serverSrc, /kind === "guildShop"/);
  assert.match(serverSrc, /\{ t: "sync", kind: "guildShop" \}/);
  const clientSrc = read("app/games/worldbox/WorldBoxClient.tsx");
  assert.match(clientSrc, /msg\.kind === "guildShop"/);
  assert.match(clientSrc, /guildShopRefreshRef\.current\(true\)/);
  assert.match(clientSrc, /notifyGuildShopChanged\(\)/);
  assert.match(clientSrc, /GUILD_PLOT_ANCHORS\[plot\.idx\]/);
  assert.match(clientSrc, /fillText\(plot\.guildName, gx, gy - 5\)/);
  const panelSrc = read("app/games/worldbox/WorldBoxGuildShopPanel.tsx");
  assert.match(panelSrc, /onGuildShopChanged/);
});

test("chat: appendChatMessage がリスト単位のロックで直列化される", () => {
  const src = read("lib/worldbox/social/chat-online.ts");
  assert.match(src, /withUserLock\(`chat-list:\$\{namespaceFor\(message\.channel\)\}:\$\{key\}`/);
});

test("casino: 先払いは submitSpend（直接提出）で、BJ の hit/stand に確認ゲートがある", () => {
  const src = read("app/api/worldbox/casino/route.ts");
  assert.match(src, /async function submitSpend\(/);
  assert.match(src, /await submitEconomyOp\(op\)/);
  for (const reason of ["slot7Prepay", "doubleBet", "blackjackBet"]) {
    assert.match(
      src,
      new RegExp(
        `submitSpend\\(ctx\\.userKey, ctx\\.discordId, \\{\\s*amount: \\w+,\\s*reason: CASINO_SESSION_REASONS\\.${reason},?\\s*\\}\\)`,
      ),
      reason,
    );
  }
  const hitIdx = src.indexOf('action === "bj_hit"');
  const gateIdx = src.indexOf("spendStatuses(ctx.userKey, bjs.spendOpIds)", hitIdx);
  assert.ok(gateIdx > hitIdx, "bj_hit/stand に先払い確認が無い");
  const gateBlock = src.slice(gateIdx, gateIdx + 400);
  assert.match(gateBlock, /bet_pending/);
  assert.match(gateBlock, /bet_failed/);
});
