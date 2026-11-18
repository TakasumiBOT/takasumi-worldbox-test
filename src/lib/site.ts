export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");

export function resolveSiteUrl(request?: Request): string {
  if (SITE_URL) return SITE_URL;
  if (request) {
    const forwardedHost = request.headers.get("x-forwarded-host");
    const host = forwardedHost ?? request.headers.get("host");
    if (host) {
      const proto = request.headers.get("x-forwarded-proto") ?? "https";
      return `${proto}://${host}`;
    }
    try {
      return new URL(request.url).origin;
    } catch {
      // fallthrough
    }
  }
  return "";
}

export const BOT_INVITE_URL =
  "https://discord.com/oauth2/authorize?client_id=1476636487784337428&permissions=4544817123422033&integration_type=0&scope=bot%20applications.commands";

export const SUPPORT_SERVER_URL = "https://discord.gg/dCAQzJUaa9";

export const INVITE_SOURCES = [
  "topgg",
  "botsgg",
  "dclist",
  "dissoku",
  "disboard",
  "x",
  "note",
  "website",
] as const;

export const DEFAULT_INVITE_SOURCE = "direct";

export function normalizeInviteSource(raw: string | null | undefined): string {
  if (typeof raw !== "string") return DEFAULT_INVITE_SOURCE;
  const src = raw.trim().toLowerCase();
  if (!/^[a-z0-9-]{1,32}$/.test(src)) return DEFAULT_INVITE_SOURCE;
  return (INVITE_SOURCES as readonly string[]).includes(src) ? src : DEFAULT_INVITE_SOURCE;
}

export const INVITE_CLICKS_NAMESPACE = "invite_clicks";

export const PUBLIC_RANKING_NAMESPACE = "public_ranking";
export const PUBLIC_RANKING_KEY = "snapshot";

export type RankingEntry = {
  name: string;
  value: number;
  level?: number;
};

export type PublicRankingSnapshot = {
  updated_at: string;
  exp: RankingEntry[];
  coin: RankingEntry[];
  bump: RankingEntry[];
  up: RankingEntry[];
  rta: RtaBoardSet;
  servers: ServerBoardSet;
};

export type ServerRankingEntry = {
  name: string;
  icon?: string;
  points: number;
  actives: number;
  messages: number;
  vc_seconds: number;
};

export type ServerBoardSet = {
  today: ServerRankingEntry[];
  week: ServerRankingEntry[];
  month: ServerRankingEntry[];
};

export const SERVER_PERIODS: { key: keyof ServerBoardSet; label: string }[] = [
  { key: "today", label: "今日" },
  { key: "week", label: "7日" },
  { key: "month", label: "30日" },
];

export type RtaEntry = RankingEntry & { at?: string; service?: string };

export type RtaBoardSet = { fast: RtaEntry[]; slow: RtaEntry[] };

export const RTA_SERVICES: { key: string; label: string }[] = [
  { key: "bump", label: "bump" },
  { key: "up", label: "up" },
  { key: "vote", label: "鯖ちゃんねる" },
  { key: "takasumi", label: "TakasumiBOT" },
  { key: "dicoall", label: "Dicoall" },
  { key: "dcafe", label: "Discord Cafe" },
  { key: "sharkbot", label: "SharkBot" },
  { key: "dsio", label: "DiscordServers.io" },
  { key: "discom", label: "DISCOM" },
];

export const RTA_SERVICE_LABELS: Record<string, string> = Object.fromEntries(
  RTA_SERVICES.map((s) => [s.key, s.label]),
);

function cleanEntries(raw: unknown, withLevel: boolean): RankingEntry[] {
  if (!Array.isArray(raw)) return [];
  const entries: RankingEntry[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.value !== "number" || !Number.isFinite(record.value)) continue;
    const entry: RankingEntry = {
      name: typeof record.name === "string" ? record.name : "",
      value: Math.trunc(record.value),
    };
    if (withLevel && typeof record.level === "number" && Number.isFinite(record.level)) {
      entry.level = Math.trunc(record.level);
    }
    entries.push(entry);
  }
  return entries;
}

function cleanRtaEntries(raw: unknown): RtaEntry[] {
  if (!Array.isArray(raw)) return [];
  const entries: RtaEntry[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.value !== "number" || !Number.isFinite(record.value)) continue;
    const entry: RtaEntry = {
      name: typeof record.name === "string" ? record.name : "",
      value: Math.trunc(record.value),
    };
    if (typeof record.at === "string" && record.at !== "") entry.at = record.at;
    if (typeof record.service === "string" && record.service !== "") {
      entry.service = record.service;
    }
    entries.push(entry);
  }
  return entries;
}

function cleanRtaBoard(
  raw: unknown,
  legacy: { bump: RankingEntry[]; up: RankingEntry[] },
): RtaBoardSet {
  const source =
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  if (Array.isArray(source.fast) || Array.isArray(source.slow)) {
    return { fast: cleanRtaEntries(source.fast), slow: cleanRtaEntries(source.slow) };
  }
  const all = source.all;
  if (typeof all === "object" && all !== null) {
    const set = all as Record<string, unknown>;
    return { fast: cleanRtaEntries(set.fast), slow: cleanRtaEntries(set.slow) };
  }
  if (Object.keys(source).length === 0) {
    const fast = [
      ...legacy.bump.map((e) => ({ ...e, service: "bump" })),
      ...legacy.up.map((e) => ({ ...e, service: "up" })),
    ].sort((a, b) => a.value - b.value);
    return { fast, slow: [] };
  }
  return { fast: [], slow: [] };
}

function cleanServerEntries(raw: unknown): ServerRankingEntry[] {
  if (!Array.isArray(raw)) return [];
  const entries: ServerRankingEntry[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.points !== "number" || !Number.isFinite(record.points)) continue;
    const entry: ServerRankingEntry = {
      name: typeof record.name === "string" ? record.name : "",
      points: Math.trunc(record.points),
      actives: cleanCount(record.actives),
      messages: cleanCount(record.messages),
      vc_seconds: cleanCount(record.vc_seconds),
    };
    if (typeof record.icon === "string" && record.icon !== "") entry.icon = record.icon;
    entries.push(entry);
  }
  return entries;
}

function cleanServerBoards(raw: unknown): ServerBoardSet {
  const source =
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  return {
    today: cleanServerEntries(source.today),
    week: cleanServerEntries(source.week),
    month: cleanServerEntries(source.month),
  };
}

export function parseRankingSnapshot(raw: unknown): PublicRankingSnapshot | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.updated_at !== "string" || record.updated_at === "") return null;
  const bump = cleanEntries(record.bump, false);
  const up = cleanEntries(record.up, false);
  return {
    updated_at: record.updated_at,
    exp: cleanEntries(record.exp, true),
    coin: cleanEntries(record.coin, false),
    bump,
    up,
    rta: cleanRtaBoard(record.rta, { bump, up }),
    servers: cleanServerBoards(record.servers),
  };
}

export const BOT_STATUS_NAMESPACE = "bot_status";
export const BOT_STATUS_KEY = "snapshot";

export const BOT_STATUS_FRESH_MS = 15 * 60 * 1000;

export type BotStatusSnapshot = {
  updated_at: string;
  started_at: string | null;
  guild_count: number;
  member_count: number;
  latency_ms: number | null;
};

function cleanCount(raw: unknown): number {
  return typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : 0;
}

function cleanOptionalCount(raw: unknown): number | null {
  return typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : null;
}

function cleanIsoString(raw: unknown): string | null {
  return typeof raw === "string" && raw !== "" && !Number.isNaN(Date.parse(raw)) ? raw : null;
}

export function parseBotStatusSnapshot(raw: unknown): BotStatusSnapshot | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const updatedAt = cleanIsoString(record.updated_at);
  if (updatedAt === null) return null;
  return {
    updated_at: updatedAt,
    started_at: cleanIsoString(record.started_at),
    guild_count: cleanCount(record.guild_count),
    member_count: cleanCount(record.member_count),
    latency_ms: cleanOptionalCount(record.latency_ms),
  };
}

export const BOT_STATUS_HISTORY_KEY = "history";

export type BotStatusDay = {
  date: string;
  samples: number;
  guilds: number;
  users: number;
};

export type BotStatusHistory = {
  days: BotStatusDay[];
  cmdHours: { hour: string; count: number }[];
};

const BOT_STATUS_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const BOT_STATUS_HOUR_RE = /^\d{4}-\d{2}-\d{2}T\d{2}$/;

export function parseBotStatusHistory(raw: unknown): BotStatusHistory | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const days: BotStatusDay[] = [];
  if (typeof record.days === "object" && record.days !== null && !Array.isArray(record.days)) {
    for (const [date, value] of Object.entries(record.days as Record<string, unknown>)) {
      if (!BOT_STATUS_DATE_RE.test(date)) continue;
      if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
      const entry = value as Record<string, unknown>;
      days.push({
        date,
        samples: cleanCount(entry.samples),
        guilds: cleanCount(entry.guilds),
        users: cleanCount(entry.users),
      });
    }
  }
  days.sort((a, b) => a.date.localeCompare(b.date));
  const cmdHours: BotStatusHistory["cmdHours"] = [];
  if (
    typeof record.cmd_hours === "object" &&
    record.cmd_hours !== null &&
    !Array.isArray(record.cmd_hours)
  ) {
    for (const [hour, value] of Object.entries(record.cmd_hours as Record<string, unknown>)) {
      if (!BOT_STATUS_HOUR_RE.test(hour)) continue;
      cmdHours.push({ hour, count: cleanCount(value) });
    }
  }
  cmdHours.sort((a, b) => a.hour.localeCompare(b.hour));
  if (days.length === 0 && cmdHours.length === 0) return null;
  return { days, cmdHours };
}

export function isBotStatusFresh(snapshot: BotStatusSnapshot, now: Date = new Date()): boolean {
  const updatedMs = Date.parse(snapshot.updated_at);
  if (Number.isNaN(updatedMs)) return false;
  return now.getTime() - updatedMs <= BOT_STATUS_FRESH_MS;
}

export type SiteLink = { href: string; label: string; external?: boolean };

export const PRIMARY_NAV: SiteLink[] = [
  { href: "/features", label: "機能紹介" },
  { href: "/commands", label: "コマンド" },
  { href: "/games", label: "ゲーム" },
  { href: "/ranking", label: "ランキング" },
];

export const UTILITY_NAV: SiteLink[] = [
  { href: SUPPORT_SERVER_URL, label: "サポートサーバー", external: true },
  { href: "/dashboard", label: "ダッシュボード" },
];

export const FOOTER_GROUPS: { label: string; links: SiteLink[] }[] = [
  {
    label: "ツール",
    links: [
      { href: "/one-prompter", label: "One Prompter" },
      { href: "/compute", label: "計算に参加" },
    ],
  },
  {
    label: "サポート",
    links: [
      { href: SUPPORT_SERVER_URL, label: "サポートサーバー", external: true },
      { href: "/faq", label: "よくある質問" },
      { href: "/status", label: "ステータス" },
    ],
  },
  {
    label: "サイト情報",
    links: [
      { href: "/about", label: "運営者情報" },
      { href: "/credits", label: "クレジット" },
    ],
  },
  {
    label: "ポリシー",
    links: [
      { href: "/terms", label: "利用規約" },
      { href: "/privacy", label: "プライバシーポリシー" },
    ],
  },
];

export function isNavActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
