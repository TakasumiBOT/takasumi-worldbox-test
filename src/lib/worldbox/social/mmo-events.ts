export interface MmoNewsItem {
  id: string;
  at: number;
  kind: "job" | "prison" | "machine" | "crime" | "economy";
  text: string;
}

export interface DailyMissionDef {
  id: string;
  title: string;
  desc: string;
  target: number;
  rewardCoins: number;
  rewardItem?: { id: string; count: number };
}

export const DAILY_MISSION_POOL: readonly DailyMissionDef[] = [
  {
    id: "work_shift",
    title: "メトロ・シフト勤務",
    desc: "仕事センターで任意のシフト業務を2回完了する",
    target: 2,
    rewardCoins: 600,
    rewardItem: { id: "copper_wire", count: 2 },
  },
  {
    id: "craft_tech",
    title: "インダストリアル制作",
    desc: "工作台またはエンジニアラボでアイテムや機械部品を1回制作する",
    target: 1,
    rewardCoins: 750,
    rewardItem: { id: "circuit_board", count: 1 },
  },
  {
    id: "world_action",
    title: "経済ネットワーク活動",
    desc: "取引・銀行・自販機・機械回収のいずれかを実行する",
    target: 2,
    rewardCoins: 550,
  },
  {
    id: "law_duty",
    title: "治安維持またはアンダーグラウンド",
    desc: "手配犯の逮捕・パトロール・刑務作業・または犯罪チャレンジを行う",
    target: 1,
    rewardCoins: 850,
  },
];

export interface PlayerQuestState {
  day: string;
  progress: Record<string, number>;
  claimed: Record<string, boolean>;
}

export function jstDayString(now: number): string {
  return new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function parseQuestState(raw: unknown, now: number): PlayerQuestState {
  const today = jstDayString(now);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { day: today, progress: {}, claimed: {} };
  }
  const v = raw as Record<string, unknown>;
  if (v.day !== today) {
    return { day: today, progress: {}, claimed: {} };
  }
  const progress: Record<string, number> = {};
  if (v.progress && typeof v.progress === "object") {
    for (const [k, n] of Object.entries(v.progress as Record<string, unknown>)) {
      if (typeof n === "number" && Number.isFinite(n) && n > 0) progress[k] = Math.floor(n);
    }
  }
  const claimed: Record<string, boolean> = {};
  if (v.claimed && typeof v.claimed === "object") {
    for (const [k, b] of Object.entries(v.claimed as Record<string, unknown>)) {
      if (b === true) claimed[k] = true;
    }
  }
  return { day: today, progress, claimed };
}
