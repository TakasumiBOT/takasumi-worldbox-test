// WORLD BOX ゲスト入場（Discord ログインなし）の検証:
// - ゲストセッションの往復（provider "guest" と所有者キー guest:<uuid>）
// - セッション秘密が未設定でもゲストだけは入れる（フォールバック署名）。
//   ただしフォールバック署名は discord / google では絶対に受理しない
// - ゲストルートの冪等性（連打で身元が増えない）と Discord の格下げ防止
// - 入場ゲート: ゲストは通る、Google は従来どおり通らない
// - /api/auth/me: ゲストの avatarUrl は null（実在しない CDN URL を作らない）
// - 経済ブリッジ: ゲストのオプは guest_not_allowed で即終端し、記録が残らない
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const rootDir = path.join(import.meta.dirname, "..");
const libDir = path.join(rootDir, "lib");
const appDir = path.join(rootDir, "app");

function transpile(name, base = libDir) {
  const src = fs.readFileSync(path.join(base, name), "utf8");
  return ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
function dataUrl(js) {
  return "data:text/javascript;base64," + Buffer.from(js).toString("base64");
}

process.env.DISCORD_SESSION_SECRET = ["worldbox", "guest", "test", "secret"].join("-");

const subdomainUrl = dataUrl(transpile("subdomain.ts"));
const headersStubUrl = dataUrl(
  "export async function cookies() { throw new Error('tests do not use cookies()'); }",
);
const authUrl = dataUrl(
  transpile("auth.ts")
    .replaceAll('"./subdomain"', JSON.stringify(subdomainUrl))
    .replaceAll('"next/headers"', JSON.stringify(headersStubUrl)),
);
const auth = await import(authUrl);

const nextServerStubUrl = dataUrl(`
class CookieJar {
  constructor() { this.map = new Map(); }
  set(name, value, options) { this.map.set(name, { name, value, options }); }
  get(name) { return this.map.get(name); }
}
export class NextResponse extends Response {
  constructor(body, init = {}) {
    super(body, init);
    this.cookies = new CookieJar();
  }
  static json(body, init = {}) {
    const headers = new Headers(init.headers || {});
    headers.set("Content-Type", "application/json");
    return new NextResponse(JSON.stringify(body), { status: init.status || 200, headers });
  }
  static redirect(url, init = {}) {
    const status = typeof init === "number" ? init : (init.status || 307);
    return new NextResponse(null, { status, headers: { Location: String(url) } });
  }
}
`);

const guestRoute = await import(
  dataUrl(
    transpile("api/auth/guest/route.ts", appDir)
      .replaceAll('"next/server"', JSON.stringify(nextServerStubUrl))
      .replaceAll('"@/lib/auth"', JSON.stringify(authUrl)),
  )
);
const gateRoute = await import(
  dataUrl(
    transpile("api/worldbox/gate/route.ts", appDir)
      .replaceAll('"next/server"', JSON.stringify(nextServerStubUrl))
      .replaceAll('"@/lib/auth"', JSON.stringify(authUrl)),
  )
);
const dashboardCoreStubUrl = dataUrl(`
export function userAvatarUrl(id, hash) { return "https://cdn.discordapp.com/avatars/" + id + "/" + (hash || "x") + ".png"; }
`);
const meRoute = await import(
  dataUrl(
    transpile("api/auth/me/route.ts", appDir)
      .replaceAll('"next/server"', JSON.stringify(nextServerStubUrl))
      .replaceAll('"@/lib/auth"', JSON.stringify(authUrl))
      .replaceAll('"@/lib/dashboard-core"', JSON.stringify(dashboardCoreStubUrl)),
  )
);

const UUID = "12345678-9abc-4def-8abc-1234567890ab";
const ME = "611111111111111111";

function cookieOf(value) {
  return `ago_session=${encodeURIComponent(value)}`;
}
function req(url, cookie) {
  return new Request(url, { headers: cookie ? { cookie } : {} });
}

// ---------- セッション ----------

test("guest: セッションの往復で provider と所有者キーが保たれる", () => {
  const value = auth.createSession({
    id: UUID,
    username: "ゲスト1234",
    avatar: null,
    provider: "guest",
  });
  const info = auth.readSessionInfo(value);
  assert.ok(info);
  assert.equal(info.provider, "guest");
  assert.equal(info.id, UUID);
  assert.equal(info.username, "ゲスト1234");
  assert.equal(auth.sessionOwnerKey(info), `guest:${UUID}`);
  const user = auth.readSession(value);
  assert.equal(user?.provider, "guest");
});

test("guest: sessionAvatarUrl は null（Discord と Google は従来どおり）", () => {
  const guest = auth.readSessionInfo(
    auth.createSession({ id: UUID, username: "ゲスト1234", avatar: null, provider: "guest" }),
  );
  assert.equal(auth.sessionAvatarUrl(guest), null);
  const discord = auth.readSessionInfo(
    auth.createSession({ id: ME, username: "d-user", avatar: "abcdef" }),
  );
  assert.equal(
    auth.sessionAvatarUrl(discord),
    "https://cdn.discordapp.com/avatars/611111111111111111/abcdef.png?size=64",
  );
  const google = auth.readSessionInfo(
    auth.createSession({
      id: "633333333333333333",
      username: "g-user",
      avatar: null,
      provider: "google",
    }),
  );
  assert.equal(auth.sessionAvatarUrl(google), null);
});

test("guest: provider 無しの旧セッションは discord として読む（後方互換）", () => {
  const info = auth.readSessionInfo(auth.createSession({ id: ME, username: "old-user" }));
  assert.equal(info?.provider, "discord");
  // ゲストの UUID を provider 無し（= discord 扱い）で読むと id の形で落ちる
  const forged = auth.createSession({ id: ME, username: "x" });
  const [encoded] = forged.split(".");
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  payload.id = UUID;
  const reEncoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  assert.equal(auth.readSessionInfo(`${reEncoded}.${forged.split(".")[1]}`), null);
});

test("guest: セッション秘密が未設定でもゲストは入れるが、discord は作れない・化けられない", () => {
  const savedSession = process.env.DISCORD_SESSION_SECRET;
  const savedClient = process.env.DISCORD_CLIENT_SECRET;
  delete process.env.DISCORD_SESSION_SECRET;
  delete process.env.DISCORD_CLIENT_SECRET;
  try {
    // ゲストはフォールバック署名で往復できる
    const value = auth.createSession({
      id: UUID,
      username: "ゲスト0001",
      avatar: null,
      provider: "guest",
    });
    const info = auth.readSessionInfo(value);
    assert.equal(info?.provider, "guest");
    assert.equal(info?.id, UUID);
    // discord セッションは秘密なしでは作れない（従来どおり）
    assert.throws(
      () => auth.createSession({ id: ME, username: "d-user" }),
      /session secret is not configured/,
    );
    // フォールバック署名のペイロードを discord に書き換えても受理しない
    const [encoded, signature] = value.split(".");
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    payload.provider = "discord";
    payload.id = ME;
    const reEncoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    assert.equal(auth.readSessionInfo(`${reEncoded}.${signature}`), null);
  } finally {
    process.env.DISCORD_SESSION_SECRET = savedSession;
    if (savedClient === undefined) delete process.env.DISCORD_CLIENT_SECRET;
    else process.env.DISCORD_CLIENT_SECRET = savedClient;
  }
});

// ---------- ゲストルート + ゲート + me ----------

const URL_GUEST = "https://example.test/api/auth/guest";
const URL_GATE = "https://example.test/api/worldbox/gate";
const URL_ME = "https://example.test/api/auth/me";

test("API(guest): POST でセッションが張られ、2回目は同じ身元が返る（冪等）", async () => {
  const first = await guestRoute.POST(req(URL_GUEST));
  assert.equal(first.status, 200);
  const firstData = await first.json();
  assert.equal(firstData.ok, true);
  assert.match(firstData.user.name, /^ゲスト\d{4}$/);
  const cookie = first.cookies.get("ago_session");
  assert.ok(cookie?.value, "ago_session Cookie が張られる");
  const info = auth.readSessionInfo(cookie.value);
  assert.equal(info?.provider, "guest");
  assert.equal(info?.username, firstData.user.name);

  // 2回目: 同じ名前が返り、新しい Cookie は張られない
  const second = await guestRoute.POST(req(URL_GUEST, cookieOf(cookie.value)));
  assert.equal(second.status, 200);
  assert.equal((await second.json()).user.name, firstData.user.name);
  assert.equal(
    second.cookies.get("ago_session"),
    undefined,
    "既存ゲストには Cookie を張り直さない",
  );

  // そのセッションでゲートが開く
  const gate = await gateRoute.GET(req(URL_GATE, cookieOf(cookie.value)));
  assert.equal((await gate.json()).allowed, true);
});

test("API(guest): Discord セッションは格下げされず、Google はゲストへ切り替えられる", async () => {
  const discord = auth.createSession({ id: ME, username: "d-user" });
  const kept = await guestRoute.POST(req(URL_GUEST, cookieOf(discord)));
  assert.equal((await kept.json()).user.name, "d-user");
  assert.equal(kept.cookies.get("ago_session"), undefined, "Discord セッションを上書きしない");

  const google = auth.createSession({
    id: "633333333333333333",
    username: "g-user",
    avatar: null,
    provider: "google",
  });
  const switched = await guestRoute.POST(req(URL_GUEST, cookieOf(google)));
  assert.match((await switched.json()).user.name, /^ゲスト\d{4}$/);
  const newCookie = switched.cookies.get("ago_session");
  assert.ok(newCookie?.value, "Google セッションにはゲスト Cookie が張られる");
  assert.equal(auth.readSessionInfo(newCookie.value)?.provider, "guest");
});

test("API(gate): ゲストは通り、Google と未ログインは従来どおり閉じる", async () => {
  const google = auth.createSession({
    id: "633333333333333333",
    username: "g-user",
    avatar: null,
    provider: "google",
  });
  assert.equal(
    (await (await gateRoute.GET(req(URL_GATE, cookieOf(google)))).json()).allowed,
    false,
  );
  assert.equal((await (await gateRoute.GET(req(URL_GATE))).json()).allowed, false);
  const discord = auth.createSession({ id: ME, username: "d-user" });
  assert.equal(
    (await (await gateRoute.GET(req(URL_GATE, cookieOf(discord)))).json()).allowed,
    true,
  );
});

test("API(me): ゲストの avatarUrl は null、Discord は CDN URL", async () => {
  const guest = auth.createSession({
    id: UUID,
    username: "ゲスト1234",
    avatar: null,
    provider: "guest",
  });
  const guestData = await (await meRoute.GET(req(URL_ME, cookieOf(guest)))).json();
  assert.equal(guestData.user.name, "ゲスト1234");
  assert.equal(guestData.user.avatarUrl, null);
  const discord = auth.createSession({ id: ME, username: "d-user", avatar: "abcdef" });
  const discordData = await (await meRoute.GET(req(URL_ME, cookieOf(discord)))).json();
  assert.equal(
    discordData.user.avatarUrl,
    "https://cdn.discordapp.com/avatars/611111111111111111/abcdef.png",
  );
});

// ---------- 経済ブリッジ ----------

const botApiStubUrl = dataUrl(`
const store = new Map();
globalThis.__wbGuestEcoStore = store;
export function isBotApiConfigured() { return true; }
export async function kvGet(ns, key) { const v = store.get(ns + " " + key); return v === undefined ? null : v; }
export async function kvSet(ns, key, value) { store.set(ns + " " + key, value); }
export async function kvDelete(ns, key) { store.delete(ns + " " + key); }
export async function kvList(ns) {
  const m = new Map();
  for (const [k, v] of store) if (k.startsWith(ns + " ")) m.set(k.slice(ns.length + 1), v);
  return m;
}
export async function tableSelect() { return []; }
export async function tableInsert() {}
export async function tableUpdate() { return []; }
export class BotApiError extends Error { constructor(status, code) { super("api " + status); this.status = status; this.code = code; } }
export async function rpc() { throw new Error("unexpected rpc"); }
`);
const economyUrl = dataUrl(transpile("worldbox/economy/economy-bridge.ts"));
const economyOnline = await import(
  dataUrl(
    transpile("worldbox/economy/economy-bridge-online.ts")
      .replaceAll('"../../bot-api"', JSON.stringify(botApiStubUrl))
      .replaceAll('"./economy-bridge"', JSON.stringify(economyUrl)),
  )
);
const eco = await import(economyUrl);

test("economy: ゲストのオプは guest_not_allowed で即終端し、記録も残高も触らない", async () => {
  const guestKey = `guest:${UUID}`;
  // buildEconomyOp の時点で作れない（最初の壁）
  assert.equal(
    eco.buildEconomyOp(
      { kind: "earn", userKey: guestKey, discordId: UUID, amount: 100, reason: "harvest" },
      "op-guest-01",
      1,
    ),
    null,
  );
  // 手組みのオプを直接 submit しても弾かれる（ブリッジの壁）
  const op = {
    id: "op-guest-01",
    kind: "earn",
    userKey: guestKey,
    discordId: UUID,
    amount: 100,
    reason: "harvest",
    status: "pending",
    createdAt: 1,
  };
  const result = await economyOnline.submitEconomyOp(op);
  assert.equal(result.state, "failed");
  assert.equal(result.op.status, "failed");
  assert.equal(result.op.error, "guest_not_allowed");
  assert.equal(await economyOnline.enqueueEconomyOp(op), false);
  assert.equal(await economyOnline.enqueueEconomyOpOnce(op), false);
  assert.equal(globalThis.__wbGuestEcoStore.size, 0, "オプ記録も台帳も残らない");
});

// ---------- クライアント配線 ----------

test("配線: ゲート画面にゲスト導線、経済・カジノパネルにゲスト文言", () => {
  const client = fs.readFileSync(path.join(appDir, "games/worldbox/WorldBoxClient.tsx"), "utf8");
  assert.ok(client.includes("ゲストで入る"), "ゲストボタンが無い");
  assert.ok(client.includes('fetch("/api/auth/guest"'), "ゲスト API を呼んでいない");
  assert.ok(
    client.includes("/api/auth/discord/authorize?next=/games/worldbox"),
    "Discord 導線が残っていない",
  );
  for (const panel of [
    "WorldBoxEconomyPanel.tsx",
    "WorldBoxCasinoPanel.tsx",
    "WorldBoxArenaPanel.tsx",
    "WorldBoxRacingPanel.tsx",
  ]) {
    const src = fs.readFileSync(path.join(appDir, "games/worldbox", panel), "utf8");
    assert.ok(
      src.includes('guest_not_allowed: "ゲストはコイン機能を使えません"'),
      `${panel} にゲスト文言が無い`,
    );
  }
});
