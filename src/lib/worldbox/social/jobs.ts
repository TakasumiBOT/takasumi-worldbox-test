export type CareerId =
  | "freelancer"
  | "retail"
  | "farmer"
  | "miner"
  | "engineer"
  | "builder"
  | "trader"
  | "medic"
  | "police"
  | "lawyer"
  | "journalist"
  | "broker";

export type CertificationId =
  | "heavy_machinery"
  | "security_officer"
  | "bar_exam"
  | "master_engineer"
  | "financier_license";

export interface CareerDef {
  id: CareerId;
  name: string;
  badge: string;
  category: "街の商業" | "産業・技術" | "公共・治安" | "金融・情報";
  desc: string;
  basePay: number;
  hungerCost: number;
  cooldownMs: number;
  minLevelReq: number;
  certRequired?: CertificationId;
  perkLabel: string;
  dropItems?: readonly { itemId: string; chance: number }[];
  isRisky?: boolean;
}

export const CAREERS: readonly CareerDef[] = [
  {
    id: "freelancer",
    name: "メトロ配達ギグ",
    badge: "📦",
    category: "街の商業",
    desc: "フードデリバリーや書類配送を担う都市の基本ワーク。初心者でも即収入。",
    basePay: 280,
    hungerCost: 8,
    cooldownMs: 35_000,
    minLevelReq: 1,
    perkLabel: "クールタイム最短・安定報酬",
    dropItems: [{ itemId: "energy_drink", chance: 0.12 }],
  },
  {
    id: "retail",
    name: "コンビニ・カフェ接客",
    badge: "☕",
    category: "街の商業",
    desc: "レジ会計・コーヒー抽出・棚出しを行う都市接客ワーク。",
    basePay: 360,
    hungerCost: 9,
    cooldownMs: 45_000,
    minLevelReq: 1,
    perkLabel: "時折パンや軽食の支給あり",
    dropItems: [{ itemId: "onigiri", chance: 0.2 }],
  },
  {
    id: "farmer",
    name: "スマート農業技師",
    badge: "🌱",
    category: "産業・技術",
    desc: "作物の生育管理と水耕ラボ保守を担当するアグリ専門職。",
    basePay: 420,
    hungerCost: 10,
    cooldownMs: 50_000,
    minLevelReq: 1,
    perkLabel: "作物の種を副収入として支給",
    dropItems: [
      { itemId: "wheat_seed", chance: 0.28 },
      { itemId: "tomato_seed", chance: 0.18 },
    ],
  },
  {
    id: "miner",
    name: "重機採掘オペレーター",
    badge: "⛏️",
    category: "産業・技術",
    desc: "大型重機と掘削ドリルを操り希少鉱脈を切り開くエネルギー産業職。",
    basePay: 540,
    hungerCost: 12,
    cooldownMs: 60_000,
    minLevelReq: 2,
    perkLabel: "石炭や銅鉱石を確率入手・重機免許で+25%",
    dropItems: [
      { itemId: "coal", chance: 0.25 },
      { itemId: "copper_ore", chance: 0.18 },
    ],
  },
  {
    id: "engineer",
    name: "機械エンジニア",
    badge: "⚙️",
    category: "産業・技術",
    desc: "自動機械の制御プログラム開発と回路設計を手掛ける技術職。",
    basePay: 680,
    hungerCost: 10,
    cooldownMs: 65_000,
    minLevelReq: 2,
    perkLabel: "制御基板や銅線を入手・技術免許で+35%",
    dropItems: [
      { itemId: "copper_wire", chance: 0.25 },
      { itemId: "circuit_board", chance: 0.12 },
    ],
  },
  {
    id: "builder",
    name: "都市建築士",
    badge: "🏗️",
    category: "産業・技術",
    desc: "ワールドや商業区画の建築設計・インフラ整備を担う。",
    basePay: 620,
    hungerCost: 11,
    cooldownMs: 60_000,
    minLevelReq: 2,
    perkLabel: "鋼鉄プレート等の建材を入手",
    dropItems: [
      { itemId: "stone", chance: 0.35 },
      { itemId: "steel_plate", chance: 0.14 },
    ],
  },
  {
    id: "medic",
    name: "メトロ救急救命士",
    badge: "🩺",
    category: "公共・治安",
    desc: "街の健康維持・救急搬送を担うスペシャリスト。",
    basePay: 580,
    hungerCost: 6,
    cooldownMs: 55_000,
    minLevelReq: 2,
    perkLabel: "業務後コンディション調整（消耗減＆薬草付与）",
    dropItems: [{ itemId: "potion", chance: 0.12 }],
  },
  {
    id: "police",
    name: "メトロ治安維持官（警察・看守）",
    badge: "🛡️",
    category: "公共・治安",
    desc: "街のパトロールと指名手配犯の逮捕・刑務所管理を担当する花形職。",
    basePay: 700,
    hungerCost: 11,
    cooldownMs: 60_000,
    minLevelReq: 2,
    perkLabel: "逮捕懸賞金1.25倍＋警備資格で1.5倍",
    dropItems: [{ itemId: "police_cuffs", chance: 0.08 }],
  },
  {
    id: "lawyer",
    name: "企業・刑事弁護士",
    badge: "⚖️",
    category: "公共・治安",
    desc: "司法取引・保釈請求・企業コンプライアンスを統括する法律のプロ。",
    basePay: 920,
    hungerCost: 9,
    cooldownMs: 75_000,
    minLevelReq: 3,
    certRequired: "bar_exam",
    perkLabel: "保釈コスト25%軽減（自分＆依頼者）",
  },
  {
    id: "trader",
    name: "クオンツ証券アナリスト",
    badge: "📈",
    category: "金融・情報",
    desc: "コモディティや株式ボードを分析し市場流動性を回す高度金融職。",
    basePay: 980,
    hungerCost: 9,
    cooldownMs: 75_000,
    minLevelReq: 3,
    certRequired: "financier_license",
    perkLabel: "高単価金融報酬＋データシャードドロップ",
    dropItems: [{ itemId: "data_shard", chance: 0.15 }],
  },
  {
    id: "journalist",
    name: "メトロ都市報道記者",
    badge: "📰",
    category: "金融・情報",
    desc: "経済動向や警察事件を取材して街のニュースティッカーへ届ける報道職。",
    basePay: 600,
    hungerCost: 8,
    cooldownMs: 55_000,
    minLevelReq: 2,
    perkLabel: "シフト完了で街ニュースを発信",
  },
  {
    id: "broker",
    name: "アンダーグラウンド情報屋",
    badge: "🕶️",
    category: "金融・情報",
    desc: "表経済の裏で高報酬の極秘案件を仲介するハイリスク職業。",
    basePay: 1250,
    hungerCost: 12,
    cooldownMs: 85_000,
    minLevelReq: 3,
    perkLabel: "超高単価だが確率で手配度★+1リスク＆闇道具入手",
    dropItems: [{ itemId: "lockpick", chance: 0.18 }],
    isRisky: true,
  },
];

const CAREER_BY_ID = new Map<string, CareerDef>(CAREERS.map((c) => [c.id, c]));

export function careerById(id: unknown): CareerDef | null {
  return typeof id === "string" ? (CAREER_BY_ID.get(id) ?? null) : null;
}

export interface CertificationDef {
  id: CertificationId;
  name: string;
  cost: number;
  minLevel: number;
  desc: string;
}

export const CERTIFICATIONS: readonly CertificationDef[] = [
  {
    id: "heavy_machinery",
    name: "大型・重機オペレーター免許",
    cost: 4000,
    minLevel: 1,
    desc: "採掘・建築系ジョブ報酬+25%",
  },
  {
    id: "security_officer",
    name: "上級警備・看守主任資格",
    cost: 6000,
    minLevel: 2,
    desc: "警察ジョブ給与+25%・逮捕報酬さらに+25%",
  },
  {
    id: "master_engineer",
    name: "第一級電子機械技師免許",
    cost: 8000,
    minLevel: 2,
    desc: "機械エンジニアの給与+35%＆高品質電子部品確率UP",
  },
  {
    id: "bar_exam",
    name: "タカスミ司法試験合格証（弁護士資格）",
    cost: 12000,
    minLevel: 3,
    desc: "弁護士キャリア解放・すべての保釈金25%割引",
  },
  {
    id: "financier_license",
    name: "第一種証券外務員ライセンス",
    cost: 15000,
    minLevel: 3,
    desc: "クオンツ証券アナリスト解放・高単価マーケット収入",
  },
];

export const CERT_BY_ID = new Map<string, CertificationDef>(CERTIFICATIONS.map((c) => [c.id, c]));

export interface JobTaskPrompt {
  id: string;
  careerId: CareerId;
  prompt: string;
  choices: readonly string[];
  correctIndex: number;
  expiresAt: number;
}

export interface JobProfile {
  currentCareer: CareerId;
  xp: number;
  level: number;
  shiftsCompleted: number;
  totalEarned: number;
  totalTaxPaid: number;
  creditScore: number; // 300 - 900 (TakasumiBOT inspired!)
  certifications: CertificationId[];
  lastShiftAt: number;
  lastInsuranceAt: number;
  streakDays: number;
  lastWorkDay: string;
  activeTask: JobTaskPrompt | null;
}

export const WORK_TAX_RATE = 0.1;
export const UNEMPLOYMENT_COOLDOWN_MS = 10 * 60 * 1000;
export const UNEMPLOYMENT_BASE_PAYOUT = 600;
export const UNEMPLOYMENT_MAX_BALANCE = 15_000;

export function xpForNextLevel(level: number): number {
  return Math.max(50, level * level * 45);
}

export function jstDayKey(now: number): string {
  const jst = new Date(now + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

export function defaultJobProfile(): JobProfile {
  return {
    currentCareer: "freelancer",
    xp: 0,
    level: 1,
    shiftsCompleted: 0,
    totalEarned: 0,
    totalTaxPaid: 0,
    creditScore: 600,
    certifications: [],
    lastShiftAt: 0,
    lastInsuranceAt: 0,
    streakDays: 0,
    lastWorkDay: "",
    activeTask: null,
  };
}

export function parseJobProfile(raw: unknown): JobProfile {
  const base = defaultJobProfile();
  let data: unknown = raw;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return base;
    }
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return base;
  const v = data as Record<string, unknown>;
  const career = careerById(v.currentCareer)?.id ?? base.currentCareer;
  const certs = Array.isArray(v.certifications)
    ? v.certifications.filter(
        (c): c is CertificationId => typeof c === "string" && CERT_BY_ID.has(c),
      )
    : [];
  const level =
    typeof v.level === "number" && Number.isFinite(v.level)
      ? Math.max(1, Math.min(50, Math.floor(v.level)))
      : 1;
  const creditScore =
    typeof v.creditScore === "number" && Number.isFinite(v.creditScore)
      ? Math.max(300, Math.min(900, Math.floor(v.creditScore)))
      : base.creditScore;
  let activeTask: JobTaskPrompt | null = null;
  if (v.activeTask && typeof v.activeTask === "object") {
    const t = v.activeTask as Record<string, unknown>;
    if (
      typeof t.id === "string" &&
      careerById(t.careerId) &&
      typeof t.prompt === "string" &&
      Array.isArray(t.choices) &&
      t.choices.length >= 2 &&
      typeof t.correctIndex === "number" &&
      typeof t.expiresAt === "number"
    ) {
      activeTask = {
        id: t.id,
        careerId: t.careerId as CareerId,
        prompt: t.prompt,
        choices: t.choices.map((c) => String(c)),
        correctIndex: Math.floor(t.correctIndex),
        expiresAt: t.expiresAt,
      };
    }
  }
  return {
    currentCareer: career,
    xp: typeof v.xp === "number" && Number.isFinite(v.xp) && v.xp >= 0 ? Math.floor(v.xp) : 0,
    level,
    shiftsCompleted:
      typeof v.shiftsCompleted === "number" &&
      Number.isFinite(v.shiftsCompleted) &&
      v.shiftsCompleted >= 0
        ? Math.floor(v.shiftsCompleted)
        : 0,
    totalEarned:
      typeof v.totalEarned === "number" && Number.isFinite(v.totalEarned) && v.totalEarned >= 0
        ? Math.floor(v.totalEarned)
        : 0,
    totalTaxPaid:
      typeof v.totalTaxPaid === "number" && Number.isFinite(v.totalTaxPaid) && v.totalTaxPaid >= 0
        ? Math.floor(v.totalTaxPaid)
        : 0,
    creditScore,
    certifications: Array.from(new Set(certs)),
    lastShiftAt:
      typeof v.lastShiftAt === "number" && Number.isFinite(v.lastShiftAt) ? v.lastShiftAt : 0,
    lastInsuranceAt:
      typeof v.lastInsuranceAt === "number" && Number.isFinite(v.lastInsuranceAt)
        ? v.lastInsuranceAt
        : 0,
    streakDays:
      typeof v.streakDays === "number" && Number.isFinite(v.streakDays) && v.streakDays >= 0
        ? Math.floor(v.streakDays)
        : 0,
    lastWorkDay: typeof v.lastWorkDay === "string" ? v.lastWorkDay : "",
    activeTask,
  };
}

export function generateJobTask(
  careerId: CareerId,
  now: number,
  rand = Math.random,
): JobTaskPrompt {
  const pick = <T>(arr: readonly T[]) => arr[Math.floor(rand() * arr.length) % arr.length];
  const r = rand();

  if (careerId === "retail" || careerId === "trader" || careerId === "freelancer") {
    const a = 120 + Math.floor(r * 40) * 10;
    const qty = 2 + Math.floor(rand() * 4);
    const ans = a * qty;
    const wrong1 = ans + 100;
    const wrong2 = Math.max(50, ans - 80);
    const choices = [
      `¥${ans.toLocaleString()}`,
      `¥${wrong1.toLocaleString()}`,
      `¥${wrong2.toLocaleString()}`,
    ];
    const order = [0, 1, 2].sort(() => rand() - 0.5);
    return {
      id: `${careerId}-${now}`,
      careerId,
      prompt: `精算チェック：単価 ${a}円 × ${qty}点 の合計金額は？`,
      choices: order.map((i) => choices[i]),
      correctIndex: order.indexOf(0),
      expiresAt: now + 3 * 60 * 1000,
    };
  }

  const TASKS: Record<string, { q: string; good: string; bad1: string; bad2: string }[]> = {
    engineer: [
      {
        q: "回路点検：基板の消費電流を抑え発熱を防ぐ接続は？",
        good: "直列抵抗による定電流制御",
        bad1: "電源ラインの直接ショート",
        bad2: "絶縁体をすべて銅線に置換",
      },
      {
        q: "自動化ロジック：`buffer.length === 0` の時に安全停止する条件式は？",
        good: "if (bufferCount <= 0) return;",
        bad1: "while (true) consume();",
        bad2: "if (bufferCount > 0) halt();",
      },
    ],
    police: [
      {
        q: "治安維持マニュアル：防犯カメラが発報した際、最優先の確認事項は？",
        good: "座標記録と容疑者の手配照合",
        bad1: "監視カメラの電源を切る",
        bad2: "犯行現場を無断で放置する",
      },
    ],
    lawyer: [
      {
        q: "法務知識：保釈請求が認められた場合、被告人に課される義務は？",
        good: "指定条件・出頭義務の遵守",
        bad1: "保釈後に強制労働が倍増する",
        bad2: "銀行預金の全額没収",
      },
    ],
    medic: [
      {
        q: "救急トリアージ：低血糖による疲労・空腹状態への適切な初動対応は？",
        good: "栄養・糖分補給と安静確保",
        bad1: "全力疾走させる",
        bad2: "高負荷の採掘作業を命じる",
      },
    ],
    default: [
      {
        q: "業務最適化：納品スケジュールを厳守しつつ品質を保つ秘訣は？",
        good: "事前点検と余裕ある工程管理",
        bad1: "検査をすべて省略する",
        bad2: "機材を未整備のまま連続稼働",
      },
    ],
  };

  const pool = TASKS[careerId] ?? TASKS.default;
  const item = pick(pool);
  const rawChoices = [item.good, item.bad1, item.bad2];
  const order = [0, 1, 2].sort(() => rand() - 0.5);
  return {
    id: `${careerId}-${now}`,
    careerId,
    prompt: item.q,
    choices: order.map((i) => rawChoices[i]),
    correctIndex: order.indexOf(0),
    expiresAt: now + 3 * 60 * 1000,
  };
}

export function canSwitchCareer(
  profile: JobProfile,
  targetId: CareerId,
): { ok: true } | { ok: false; error: string } {
  const def = careerById(targetId);
  if (!def) return { ok: false, error: "unknown_career" };
  if (profile.level < def.minLevelReq) return { ok: false, error: "level_too_low" };
  if (def.certRequired && !profile.certifications.includes(def.certRequired)) {
    return { ok: false, error: "certification_required" };
  }
  return { ok: true };
}

export function computeShiftPayout(
  profile: JobProfile,
  career: CareerDef,
  taskCorrect: boolean | null,
): { gross: number; tax: number; net: number; bonusPct: number } {
  let mult = 1 + Math.min(1.0, (profile.level - 1) * 0.08);
  mult += Math.max(-0.15, ((profile.creditScore - 600) / 300) * 0.2);

  if (
    (career.id === "miner" || career.id === "builder") &&
    profile.certifications.includes("heavy_machinery")
  ) {
    mult += 0.25;
  }
  if (career.id === "police" && profile.certifications.includes("security_officer")) {
    mult += 0.25;
  }
  if (career.id === "engineer" && profile.certifications.includes("master_engineer")) {
    mult += 0.35;
  }
  if (taskCorrect === true) mult *= 1.4;
  else if (taskCorrect === false) mult *= 0.75;

  const gross = Math.max(50, Math.round(career.basePay * mult));
  const tax = Math.floor(gross * WORK_TAX_RATE);
  const net = gross - tax;
  const bonusPct = Math.round((mult - 1) * 100);
  return { gross, tax, net, bonusPct };
}
