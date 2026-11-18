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
        .replace(/^export\s+(?=(const|let|var|function|class)\s)/, "")
        .replace(/^export\s+(?=(async\s+function))/, "")
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

const layout = await loadBundle(
  ["worldbox/world/layout.ts"],
  [
    "WB_PORTRAIT_MAX_WIDTH",
    "WB_LANDSCAPE_MAX_HEIGHT",
    "WB_CHAT_LEFT_CLEARANCE_PX",
    "wbLayoutMode",
    "wbHudMetrics",
  ],
);

test("layout: 典型サイズのモード判定", () => {
  assert.equal(layout.wbLayoutMode(390, 844), "portrait");
  assert.equal(layout.wbLayoutMode(360, 740), "portrait");
  assert.equal(layout.wbLayoutMode(844, 390), "landscape");
  assert.equal(layout.wbLayoutMode(740, 360), "landscape");
  assert.equal(layout.wbLayoutMode(1280, 800), "wide");
  assert.equal(layout.wbLayoutMode(768, 1024), "wide", "iPad 縦は wide");
  assert.equal(layout.wbLayoutMode(1024, 768), "wide");
  assert.equal(
    layout.wbLayoutMode(800, 600),
    "wide",
    "低丈でも幅が広ければ wide ではないが landscape でもない",
  );
});

test("layout: 境界値（CSS メディアクエリと一致）", () => {
  assert.equal(layout.WB_PORTRAIT_MAX_WIDTH, 759);
  assert.equal(layout.WB_LANDSCAPE_MAX_HEIGHT, 499);
  assert.equal(layout.wbLayoutMode(759, 900), "portrait");
  assert.equal(layout.wbLayoutMode(760, 900), "wide");
  assert.equal(layout.wbLayoutMode(900, 499), "landscape");
  assert.equal(layout.wbLayoutMode(900, 500), "wide");
  assert.equal(
    layout.wbLayoutMode(500, 500),
    "portrait",
    "正方形は portrait 扱い（CSS orientation と一致）",
  );
});

test("layout: スマホのタップ下限とホットバー寸法", () => {
  for (const mode of ["portrait", "landscape"]) {
    const hud = layout.wbHudMetrics(mode);
    assert.equal(hud.buttonMinHeight, 44, `${mode} の主要ボタンは 44px`);
    assert.equal(hud.minimapPx, 88, `${mode} のミニマップは縮小`);
  }
  const portrait = layout.wbHudMetrics("portrait");
  assert.ok(portrait.hotbarSlotCss.includes("44px"));
  assert.ok(portrait.hotbarSlotCss.includes("38px"));
  assert.equal(layout.wbHudMetrics("landscape").hotbarSlotCss, "44px");
});

test("layout: チャットはスティック基点を避け、パーティカードとドックを共有する", () => {
  assert.ok(layout.WB_CHAT_LEFT_CLEARANCE_PX >= 146);
  for (const mode of ["portrait", "landscape"]) {
    const hud = layout.wbHudMetrics(mode);
    assert.equal(hud.chatOnRight, true, `${mode} のチャットは右ドック`);
    assert.ok(
      hud.playerCardBottomPx >= hud.chatBottomPx + hud.chatMessagesPx + 38,
      `${mode} のプレイヤーカードはチャットの積み上げと重ならない`,
    );
    assert.equal(
      hud.partyCardBottomPx,
      hud.chatBottomPx,
      `${mode} のパーティカードはチャットと同じドック`,
    );
  }
  assert.ok(
    layout.wbHudMetrics("landscape").chatMessagesPx <
      layout.wbHudMetrics("portrait").chatMessagesPx,
  );
});

test("layout: wide のメトリクスは従来値（PC 退行なし）", () => {
  const hud = layout.wbHudMetrics("wide");
  assert.equal(hud.minimapPx, 112);
  assert.equal(hud.hotbarSlotCss, "clamp(30px, 10.5vw, 42px)");
  assert.equal(hud.buttonMinHeight, 40);
  assert.equal(hud.chatOnRight, false);
  assert.equal(hud.chatBottomPx, 10);
  assert.equal(hud.playerCardBottomPx, 108);
  assert.equal(hud.partyCardBottomPx, 120);
});

test("layout: クライアント配線と CSS シート化", () => {
  const client = fs.readFileSync(
    path.join(rootDir, "src/app/games/worldbox/WorldBoxClient.tsx"),
    "utf8",
  );
  assert.ok(
    client.includes('from "@/lib/worldbox/world/layout"'),
    "クライアントが layout を使っていない",
  );
  assert.ok(client.includes("wbLayoutMode(viewport.w, viewport.h)"));
  assert.ok(client.includes("safe-area-inset"), "safe-area が HUD に入っていない");
  assert.ok(client.includes("hud.hotbarSlotCss"));
  assert.ok(client.includes("hud.chatOnRight"));

  const css = fs.readFileSync(path.join(rootDir, "src/app/globals.css"), "utf8");
  assert.ok(
    css.includes("@media (max-width: 759px) and (orientation: portrait)"),
    "縦持ちシートのメディアクエリが無い",
  );
  assert.ok(
    css.includes("@media (orientation: landscape) and (max-height: 499px)"),
    "横持ちのメディアクエリが無い",
  );
  assert.ok(css.includes(".wb-shell .wb-panel"), "wb-panel のシート規則が無い");
  assert.ok(css.includes("env(safe-area-inset-bottom"), "シート下端に safe-area が無い");

  for (const f of [
    "WorldBoxEconomyPanel.tsx",
    "WorldBoxCasinoPanel.tsx",
    "WorldBoxGuildBoardPanel.tsx",
    "WorldBoxGuildShopPanel.tsx",
    "WorldBoxMachinePanel.tsx",
    "WorldBoxArcadePanel.tsx",
  ]) {
    const src = fs.readFileSync(path.join(rootDir, "src/app/games/worldbox", f), "utf8");
    assert.ok(src.includes("wb-panel"), `${f} に wb-panel が無い`);
  }
  assert.ok(
    (client.match(/className="wb-panel"/g) ?? []).length >= 6,
    "内蔵パネルの wb-panel が足りない",
  );
  const machine = fs.readFileSync(
    path.join(rootDir, "src/app/games/worldbox/WorldBoxMachinePanel.tsx"),
    "utf8",
  );
  assert.ok(machine.includes("maxHeight"), "装置パネルに maxHeight が無い");
});
