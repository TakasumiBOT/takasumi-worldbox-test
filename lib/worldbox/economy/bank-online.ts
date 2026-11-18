import { isBotApiConfigured, kvGet, kvSet } from "../../bot-api";
import { emptyBankState, parseBankState, type BankState } from "./bank";

export const WORLDBOX_BANK_NAMESPACE = "worldbox_bank";
const BANK_STATE_KEY = "bank_v1";

export function isBankEnabled(): boolean {
  return isBotApiConfigured();
}

export async function loadBankState(): Promise<BankState> {
  if (!isBotApiConfigured()) return emptyBankState();
  try {
    const raw = await kvGet(WORLDBOX_BANK_NAMESPACE, BANK_STATE_KEY);
    return parseBankState(raw);
  } catch {
    return emptyBankState();
  }
}

export async function storeBankState(state: BankState): Promise<boolean> {
  if (!isBotApiConfigured()) return false;
  try {
    await kvSet(WORLDBOX_BANK_NAMESPACE, BANK_STATE_KEY, state);
    return true;
  } catch {
    return false;
  }
}
