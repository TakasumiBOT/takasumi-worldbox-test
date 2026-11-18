import { waitUntil } from "@vercel/functions";
import { isBotApiConfigured, kvGet, kvSet } from "../../bot-api";
import { sweepEconomyOps } from "../economy/economy-bridge-online";
import { runStockDividendCron } from "../economy/stock-online";
import { runCompanyCron } from "../social/company-online";

export const WORLDBOX_LAZY_JOBS_NAMESPACE = "worldbox_lazy_jobs";

export type LazyJobName = "economy_sweep" | "company_cron" | "stock_dividend";

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
    return 0;
  }
}

export async function markLazyJobRun(name: LazyJobName, now: number): Promise<void> {
  try {
    await kvSet(WORLDBOX_LAZY_JOBS_NAMESPACE, name, { lastRunAt: now });
  } catch {
    // タイムスタンプが書けなくても本処理は止めない（次回また判定する）。
  }
}

let running = false;

export function maybeRunLazyJobs(now: number = Date.now()): void {
  if (running) return;
  if (!isBotApiConfigured()) return;
  running = true;
  const work = (async () => {
    try {
      for (const name of LAZY_JOB_ORDER) {
        const last = await readLastRunAt(name);
        if (now - last < LAZY_JOB_INTERVALS_MS[name]) continue;
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
    void work;
  }
}
