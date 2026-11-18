export const PRESENCE_POLL_MS = 1_000;
export const PRESENCE_SAFETY_POLL_MS = 15_000;
export const WS_ALIVE_WINDOW_MS = 20_000;

export function isWsHealthy(wsOpen: boolean, lastWsMsgAt: number, now: number): boolean {
  return wsOpen && lastWsMsgAt > 0 && now - lastWsMsgAt <= WS_ALIVE_WINDOW_MS;
}

export function presencePollDue(args: {
  now: number;
  lastPollAt: number;
  wsHealthy: boolean;
}): boolean {
  const interval = args.wsHealthy ? PRESENCE_SAFETY_POLL_MS : PRESENCE_POLL_MS;
  return args.now - args.lastPollAt >= interval;
}
