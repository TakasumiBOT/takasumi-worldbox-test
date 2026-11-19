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

const J = await loadBundle(
  ["worldbox/social/jobs.ts", "worldbox/social/mmo-events.ts"],
  [
    "CAREERS",
    "CERTIFICATIONS",
    "careerById",
    "defaultJobProfile",
    "parseJobProfile",
    "canSwitchCareer",
    "computeShiftPayout",
    "generateJobTask",
    "xpForNextLevel",
    "DAILY_MISSION_POOL",
    "parseQuestState",
  ],
);

test("jobs: 12キャリア・5資格が揃い、転職条件と資格要件が機能する", () => {
  assert.equal(J.CAREERS.length, 12);
  assert.equal(J.CERTIFICATIONS.length, 5);

  const prof = J.defaultJobProfile();
  assert.equal(J.canSwitchCareer(prof, "retail").ok, true);
  assert.equal(J.canSwitchCareer(prof, "police").error, "level_too_low");
  assert.equal(J.canSwitchCareer({ ...prof, level: 3 }, "lawyer").error, "certification_required");
  assert.equal(
    J.canSwitchCareer({ ...prof, level: 3, certifications: ["bar_exam"] }, "lawyer").ok,
    true,
  );
});

test("jobs: インタラクティブ業務課題・資格ボーナス・税引後報酬が正しく計算される", () => {
  const now = 1_700_000_000_000;
  const eng = J.careerById("engineer");
  const task = J.generateJobTask("engineer", now);
  assert.ok(task.choices.length === 3);
  assert.ok(task.correctIndex >= 0 && task.correctIndex < 3);

  const prof = { ...J.defaultJobProfile(), level: 4, certifications: ["master_engineer"] };
  const normal = J.computeShiftPayout(prof, eng, null);
  const perfect = J.computeShiftPayout(prof, eng, true);
  assert.ok(perfect.net > normal.net, "Correct answer gives 1.4x boost");
  assert.equal(perfect.gross - perfect.tax, perfect.net);
  assert.ok(J.xpForNextLevel(2) > J.xpForNextLevel(1));
});

test("mmo quests & UI wiring: デイリー任務とUI・APIルートが接続されている", () => {
  const now = 1_700_000_000_000;
  const q = J.parseQuestState({ day: "1999-01-01", progress: { work_shift: 5 } }, now);
  assert.deepEqual(q.progress, {}, "Old day progress resets on new JST day");
  assert.ok(J.DAILY_MISSION_POOL.length >= 4);

  const route = fs.readFileSync(path.join(rootDir, "src/app/api/worldbox/jobs/route.ts"), "utf8");
  assert.match(route, /submit_shift/);
  assert.match(route, /claim_unemployment/);
  const client = fs.readFileSync(
    path.join(rootDir, "src/app/games/worldbox/WorldBoxClient.tsx"),
    "utf8",
  );
  assert.match(client, /WorldBoxJobPanel/);
  assert.match(client, /WorldBoxMetroPanel/);
});
