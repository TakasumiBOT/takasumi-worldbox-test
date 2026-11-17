// 定期処理の遅延実行（Cron の主経路化）。
//
// 背景: このデプロイでは Vercel の環境変数を触れないため CRON_SECRET が
// 設定できず、Cron ルート（economy-sweep / company-cron / stock-cron）は
// fail-closed のまま止まる。そこで通常の API トラフィックに相乗りし、
// bot_kv の最終実行タイムスタンプが所定間隔を超えたジョブだけを、
// リクエストの裏で冪等に実行する。
//
// - 間隔の担保は bot_kv（名前空間 worldbox_lazy_jobs、キー = ジョブ名、
//   値 { lastRunAt }）。実行前にタイムスタンプを進める（claim）ため、
//   複数インスタンスが同時に気づいても実害は無い（各ジョブ自体が
//   冪等キーで二重適用を防いでいる）。
// - Cron ルートが実際に処理したときは markLazyJobRun で同じタイム
//   スタンプを進める。Cron と遅延実行が併走しても二重に走らない。
// - 呼び出しは lib/bot-api.ts の入口から（kickLazyJobs）。ここでの
//   実行は waitUntil でリクエスト応答の裏に逃がし、応答を遅らせない。
import { waitUntil } from "@vercel/functions";
import { isBotApiConfigured, kvGet, kvSet } from "../../bot-api";
import { sweepEconomyOps } from "../economy/economy-bridge-online";
import { runStockDividendCron } from "../economy/stock-online";
import { runCompanyCron } from "../social/company-online";

export const WORLDBOX_LAZY_JOBS_NAMESPACE = "worldbox_lazy_jobs";

export type LazyJobName = "economy_sweep" | "company_cron" | "stock_dividend";

/**
 * ジョブごとの最小実行間隔（ミリ秒）。Cron の周期に合わせる:
 * 経済スイープは毎分、会社の給料・法人税は毎時（内部で JST の時間帯と
 * 会社ごとの冪等キーが実際の適用を決めるため、10 分間隔で見に行く）、
 * 株式の配当は日次（冪等キーは日付単位なので 1 時間間隔で十分）。
 */
export const LAZY_JOB_INTERVALS_MS: Record<LazyJobName, number> = {
  economy_sweep: 55_000,
  company_cron: 10 * 60_000,
  stock_dividend: 60 * 60_000,
};

const LAZY_JOB_RUNNERS: Record<LazyJobName, (now: number) => Promise<unknown>> = {
  economy_sweep: async () => sweepEconomyOps(),
  company_cron: async (now) => runCompanyCron(now),
  stock_dividend: async (now) => runStockDividendCron(now),
};

const LAZY_JOB_ORDER: LazyJobName[] = ["economy_sweep", "company_cron", "stock_dividend"];

async function readLastRunAt(name: LazyJobName): Promise<number> {
  try {
    const value = (await kvGet(WORLDBOX_LAZY_JOBS_NAMESPACE, name)) as {
      lastRunAt?: unknown;
    } | null;
    return typeof value?.lastRunAt === "number" && Number.isFinite(value.lastRunAt)
      ? value.lastRunAt
      : 0;
  } catch {
    // 読めないときは「未実行」として扱い、実行側の冪等性に委ねる。
    return 0;
  }
}

/** 最終実行タイムスタンプを進める（Cron ルートからも呼ぶ）。失敗は飲み込む。 */
export async function markLazyJobRun(name: LazyJobName, now: number): Promise<void> {
  try {
    await kvSet(WORLDBOX_LAZY_JOBS_NAMESPACE, name, { lastRunAt: now });
  } catch {
    // タイムスタンプが書けなくても本処理は止めない（次回また判定する）。
  }
}

let running = false;

/**
 * 間隔を超えたジョブがあれば裏で実行する。同一プロセス内では多重に
 * 走らせない（running フラグ）。ジョブの実行そのものは冪等なので、
 * プロセスをまたいで重なっても二重適用にはならない。
 */
export function maybeRunLazyJobs(now: number = Date.now()): void {
  if (running) return;
  if (!isBotApiConfigured()) return;
  running = true;
  const work = (async () => {
    try {
      for (const name of LAZY_JOB_ORDER) {
        const last = await readLastRunAt(name);
        if (now - last < LAZY_JOB_INTERVALS_MS[name]) continue;
        // claim: 先にタイムスタンプを進めてから実行する。
        await markLazyJobRun(name, now);
        await LAZY_JOB_RUNNERS[name](now);
      }
    } catch (error) {
      console.error("[lazy-jobs] failed:", error);
    } finally {
      running = false;
    }
  })();
  try {
    waitUntil(work);
  } catch {
    // リクエスト文脈の外（素の Node 等）では浮いた Promise として続行する。
    void work;
  }
}
