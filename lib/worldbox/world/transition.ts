export const TRANSITION_FADE_OUT_MS = 140;
export const TRANSITION_FADE_IN_MS = 220;
export const TRANSITION_TOTAL_MS = TRANSITION_FADE_OUT_MS + TRANSITION_FADE_IN_MS;
export const TRANSITION_ENTER_MS = 220;
export const RECONNECT_PULSE_MS = 300;
export const RECONNECT_PULSE_ALPHA = 0.25;
export const SPRITE_PRELOAD_TIMEOUT_MS = 2500;
export const TRANSITION_OVERLAY_RGB = "11,14,20";

export type TransitionKind = "warp" | "enter" | "reconnect";

const clamp01 = (v: number): number => (v <= 0 ? 0 : v >= 1 ? 1 : v);
const smooth = (t: number): number => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

export function transitionTotalMs(kind: TransitionKind): number {
  if (kind === "enter") return TRANSITION_ENTER_MS;
  if (kind === "reconnect") return RECONNECT_PULSE_MS;
  return TRANSITION_TOTAL_MS;
}

export function transitionAlpha(elapsedMs: number, kind: TransitionKind): number {
  if (elapsedMs < 0) return 0;
  if (kind === "enter") {
    if (elapsedMs >= TRANSITION_ENTER_MS) return 0;
    return 1 - smooth(elapsedMs / TRANSITION_ENTER_MS);
  }
  if (kind === "reconnect") {
    if (elapsedMs >= RECONNECT_PULSE_MS) return 0;
    return RECONNECT_PULSE_ALPHA * (1 - smooth(elapsedMs / RECONNECT_PULSE_MS));
  }
  if (elapsedMs >= TRANSITION_TOTAL_MS) return 0;
  if (elapsedMs < TRANSITION_FADE_OUT_MS) return smooth(elapsedMs / TRANSITION_FADE_OUT_MS);
  return 1 - smooth((elapsedMs - TRANSITION_FADE_OUT_MS) / TRANSITION_FADE_IN_MS);
}

export function transitionSwapDue(elapsedMs: number): boolean {
  return elapsedMs >= TRANSITION_FADE_OUT_MS;
}

export function transitionDone(elapsedMs: number, kind: TransitionKind): boolean {
  return elapsedMs >= transitionTotalMs(kind);
}

export type PreloadResult = { loaded: string[]; failed: string[]; timedOut: boolean };

export type PreloadImageLike = {
  src: string;
  onload: ((this: GlobalEventHandlers, ev: Event) => unknown) | null;
  onerror: ((this: GlobalEventHandlers, ev: Event) => unknown) | null;
  decode?: () => Promise<void>;
};

export type PreloadOptions = {
  timeoutMs?: number;
  imageFactory?: () => PreloadImageLike;
};

export function preloadImages(srcs: string[], opts: PreloadOptions = {}): Promise<PreloadResult> {
  const timeoutMs = opts.timeoutMs ?? SPRITE_PRELOAD_TIMEOUT_MS;
  const make = opts.imageFactory ?? (() => new Image() as unknown as PreloadImageLike);
  const unique = [...new Set(srcs)];
  if (unique.length === 0) return Promise.resolve({ loaded: [], failed: [], timedOut: false });
  return new Promise<PreloadResult>((resolve) => {
    const loaded: string[] = [];
    const failed: string[] = [];
    let remaining = unique.length;
    let settled = false;
    const finish = (timedOut: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ loaded, failed, timedOut });
    };
    const timer = setTimeout(() => finish(true), timeoutMs);
    for (const src of unique) {
      let done = false;
      const ok = () => {
        if (done || settled) return;
        done = true;
        loaded.push(src);
        remaining -= 1;
        if (remaining <= 0) finish(false);
      };
      const ng = () => {
        if (done || settled) return;
        done = true;
        failed.push(src);
        remaining -= 1;
        if (remaining <= 0) finish(false);
      };
      let img: PreloadImageLike;
      try {
        img = make();
      } catch {
        ng();
        continue;
      }
      img.onload = ok;
      img.onerror = ng;
      try {
        img.src = src;
      } catch {
        ng();
        continue;
      }
      if (typeof img.decode === "function") {
        img.decode().then(ok, ng);
      }
    }
  });
}
