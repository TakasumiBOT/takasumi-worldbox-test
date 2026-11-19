import { isBotApiConfigured, kvGet, kvSet } from "../../bot-api";
import { defaultJobProfile, parseJobProfile, type JobProfile } from "./jobs";

export const WORLDBOX_JOBS_NAMESPACE = "worldbox_jobs";

export function isJobsEnabled(): boolean {
  return isBotApiConfigured();
}

export async function loadJobProfile(ownerKey: string): Promise<JobProfile> {
  if (!isBotApiConfigured()) return defaultJobProfile();
  try {
    const raw = await kvGet(WORLDBOX_JOBS_NAMESPACE, `job:${ownerKey}`);
    return parseJobProfile(raw);
  } catch {
    return defaultJobProfile();
  }
}

export async function storeJobProfile(ownerKey: string, profile: JobProfile): Promise<boolean> {
  if (!isBotApiConfigured()) return false;
  try {
    await kvSet(WORLDBOX_JOBS_NAMESPACE, `job:${ownerKey}`, JSON.stringify(profile));
    return true;
  } catch {
    return false;
  }
}
