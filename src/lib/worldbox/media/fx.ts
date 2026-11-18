export type FxShape = "chip" | "spark" | "drop" | "ring" | "puff" | "leaf" | "snow" | "glow";

export type FxParticle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  gravity: number;
  drag: number;
  rot: number;
  vrot: number;
  shape: FxShape;
  color: string;
};

export type FxSystem = {
  particles: FxParticle[];
  cap: number;
  rngState: number;
  intensity: number;
};

export const FX_CAP = 260;
export const FX_BURST_MAX = 26;

export function fxRand(sys: FxSystem): number {
  sys.rngState = (sys.rngState + 0x6d2b79f5) | 0;
  let t = sys.rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function createFxSystem(seed = 1, cap = FX_CAP): FxSystem {
  return { particles: [], cap: Math.max(8, Math.floor(cap)), rngState: seed | 0, intensity: 1 };
}

export function fxLifeRatio(p: FxParticle): number {
  if (p.life <= 0) return 0;
  const r = 1 - p.age / p.life;
  return r < 0 ? 0 : r > 1 ? 1 : r;
}

function pushParticle(sys: FxSystem, p: FxParticle): void {
  if (sys.particles.length >= sys.cap) {
    let worst = 0;
    let worstRatio = Infinity;
    for (let i = 0; i < sys.particles.length; i++) {
      const r = fxLifeRatio(sys.particles[i]);
      if (r < worstRatio) {
        worstRatio = r;
        worst = i;
      }
    }
    sys.particles.splice(worst, 1);
  }
  sys.particles.push(p);
}

export function stepFx(sys: FxSystem, dt: number): void {
  if (dt <= 0) return;
  const d = Math.min(dt, 0.05);
  for (let i = sys.particles.length - 1; i >= 0; i--) {
    const p = sys.particles[i];
    p.age += d;
    if (p.age >= p.life) {
      sys.particles.splice(i, 1);
      continue;
    }
    const dragK = Math.max(0, 1 - p.drag * d);
    p.vx *= dragK;
    p.vy = p.vy * dragK + p.gravity * d;
    p.x += p.vx * d;
    p.y += p.vy * d;
    p.rot += p.vrot * d;
  }
}

export type FxBurstKind =
  | "chop"
  | "mine"
  | "debris"
  | "till"
  | "plant"
  | "harvest"
  | "place"
  | "build"
  | "splash"
  | "step"
  | "dash"
  | "warp"
  | "poof"
  | "hit"
  | "death"
  | "spawn";

type BurstSpec = {
  count: number;
  shapes: FxShape[];
  colors: string[];
  speed: [number, number];
  dir: number | null;
  spread: number;
  life: [number, number];
  size: [number, number];
  gravity: number;
  drag: number;
  vrot: number;
};

const BURSTS: Record<FxBurstKind, BurstSpec> = {
  chop: {
    count: 12,
    shapes: ["chip", "chip", "spark"],
    colors: ["#8a5a2b", "#5d3a17", "#c89b62", "#2f6121"],
    speed: [1.2, 3.4],
    dir: -Math.PI / 2,
    spread: 2.2,
    life: [0.3, 0.6],
    size: [0.06, 0.13],
    gravity: 7,
    drag: 1.2,
    vrot: 9,
  },
  mine: {
    count: 12,
    shapes: ["chip", "chip", "spark"],
    colors: ["#8d8d93", "#55555c", "#c9c9cf", "#3c3c42"],
    speed: [1.2, 3.6],
    dir: -Math.PI / 2,
    spread: 2.2,
    life: [0.3, 0.55],
    size: [0.05, 0.12],
    gravity: 7.5,
    drag: 1.2,
    vrot: 10,
  },
  debris: {
    count: 16,
    shapes: ["chip", "puff", "spark"],
    colors: ["#9a7b4f", "#6b543a", "#c9b18a", "#4c4438"],
    speed: [1.4, 4.0],
    dir: -Math.PI / 2,
    spread: 2.6,
    life: [0.35, 0.7],
    size: [0.06, 0.15],
    gravity: 7,
    drag: 1.4,
    vrot: 9,
  },
  till: {
    count: 10,
    shapes: ["chip", "puff"],
    colors: ["#8a5a2b", "#5d3a17", "#a9743f", "#3d2712"],
    speed: [0.8, 2.4],
    dir: -Math.PI / 2,
    spread: 2.0,
    life: [0.3, 0.55],
    size: [0.06, 0.13],
    gravity: 6.5,
    drag: 1.6,
    vrot: 7,
  },
  plant: {
    count: 9,
    shapes: ["spark", "chip"],
    colors: ["#69b84a", "#3e7d2c", "#cfe89a", "#8a5a2b"],
    speed: [0.6, 1.8],
    dir: -Math.PI / 2,
    spread: 2.4,
    life: [0.35, 0.65],
    size: [0.04, 0.09],
    gravity: 3.5,
    drag: 1.4,
    vrot: 5,
  },
  harvest: {
    count: 16,
    shapes: ["spark", "spark", "chip"],
    colors: ["#ffd23e", "#f59e0b", "#69b84a", "#fff3b0"],
    speed: [1.4, 3.8],
    dir: -Math.PI / 2,
    spread: 2.4,
    life: [0.4, 0.8],
    size: [0.04, 0.1],
    gravity: 5.5,
    drag: 1.1,
    vrot: 8,
  },
  place: {
    count: 8,
    shapes: ["puff", "ring"],
    colors: ["#d8cfc0", "#a89a83", "#ffffff"],
    speed: [0.5, 1.4],
    dir: null,
    spread: Math.PI * 2,
    life: [0.25, 0.45],
    size: [0.08, 0.16],
    gravity: -0.6,
    drag: 2.2,
    vrot: 0,
  },
  build: {
    count: 14,
    shapes: ["chip", "puff", "spark"],
    colors: ["#c89b62", "#8a5a2b", "#9aa0a6", "#5d3a17"],
    speed: [1.0, 3.0],
    dir: -Math.PI / 2,
    spread: 2.4,
    life: [0.35, 0.65],
    size: [0.05, 0.13],
    gravity: 6.5,
    drag: 1.4,
    vrot: 8,
  },
  splash: {
    count: 12,
    shapes: ["drop", "drop", "ring"],
    colors: ["#7cc0e8", "#3a7cb4", "#ffffff", "#bfe6ff"],
    speed: [1.0, 3.0],
    dir: -Math.PI / 2,
    spread: 1.7,
    life: [0.3, 0.55],
    size: [0.04, 0.1],
    gravity: 8,
    drag: 0.7,
    vrot: 0,
  },
  step: {
    count: 2,
    shapes: ["puff"],
    colors: ["#cfc4ae", "#a89a83"],
    speed: [0.2, 0.6],
    dir: -Math.PI / 2,
    spread: 2.6,
    life: [0.2, 0.35],
    size: [0.05, 0.09],
    gravity: -0.8,
    drag: 2.4,
    vrot: 0,
  },
  dash: {
    count: 3,
    shapes: ["spark"],
    colors: ["#ffffff", "#d8ecff"],
    speed: [0.4, 1.0],
    dir: null,
    spread: Math.PI * 2,
    life: [0.16, 0.28],
    size: [0.05, 0.1],
    gravity: 0,
    drag: 3.2,
    vrot: 0,
  },
  warp: {
    count: 20,
    shapes: ["glow", "spark"],
    colors: ["#b79cff", "#7c5cd6", "#ffffff", "#e6dcff"],
    speed: [0.3, 1.1],
    dir: -Math.PI / 2,
    spread: 0.9,
    life: [0.45, 0.9],
    size: [0.05, 0.12],
    gravity: -2.6,
    drag: 1.0,
    vrot: 0,
  },
  poof: {
    count: 10,
    shapes: ["puff"],
    colors: ["#e8e4da", "#b9b2a2", "#8d867a"],
    speed: [0.5, 1.5],
    dir: null,
    spread: Math.PI * 2,
    life: [0.35, 0.6],
    size: [0.1, 0.2],
    gravity: -1.2,
    drag: 2.0,
    vrot: 0,
  },
  hit: {
    count: 10,
    shapes: ["spark", "spark", "chip"],
    colors: ["#e5484d", "#ffffff", "#7a1f24", "#ffb3b8"],
    speed: [1.6, 4.2],
    dir: -Math.PI / 2,
    spread: 2.4,
    life: [0.18, 0.38],
    size: [0.04, 0.09],
    gravity: 6,
    drag: 1.6,
    vrot: 8,
  },
  death: {
    count: 22,
    shapes: ["chip", "puff", "chip"],
    colors: ["#c9c2b4", "#8d867a", "#5c564c", "#e8e4da"],
    speed: [1.2, 3.8],
    dir: null,
    spread: Math.PI * 2,
    life: [0.4, 0.85],
    size: [0.09, 0.22],
    gravity: 5.5,
    drag: 1.3,
    vrot: 8,
  },
  spawn: {
    count: 14,
    shapes: ["puff", "glow"],
    colors: ["#e6dcff", "#b79cff", "#ffffff", "#8d867a"],
    speed: [0.3, 1.2],
    dir: -Math.PI / 2,
    spread: 1.2,
    life: [0.4, 0.8],
    size: [0.08, 0.18],
    gravity: -2.2,
    drag: 1.2,
    vrot: 0,
  },
};

function pickPalette(colors: readonly string[], sys: FxSystem): string {
  if (colors.length === 0) return "#ffffff";
  return colors[Math.floor(fxRand(sys) * colors.length) % colors.length];
}

function emitBurst(
  sys: FxSystem,
  spec: BurstSpec,
  x: number,
  y: number,
  opts: {
    count: number;
    sizeMul?: number;
    scatterX?: number;
    scatterY?: number;
    dirX?: number;
    color?: string;
    colors?: string[];
  },
): number {
  const n = Math.max(0, Math.min(FX_BURST_MAX, Math.round(opts.count * sys.intensity)));
  const sizeMul = opts.sizeMul ?? 1;
  const scatterX = opts.scatterX ?? 0.3;
  const scatterY = opts.scatterY ?? 0.2;
  for (let i = 0; i < n; i++) {
    const baseDir = spec.dir ?? fxRand(sys) * Math.PI * 2;
    const ang = baseDir + (fxRand(sys) - 0.5) * spec.spread;
    const speed = spec.speed[0] + fxRand(sys) * (spec.speed[1] - spec.speed[0]);
    let vx = Math.cos(ang) * speed;
    const vy = Math.sin(ang) * speed;
    if (opts.dirX) vx += opts.dirX * 0.8;
    pushParticle(sys, {
      x: x + (fxRand(sys) - 0.5) * scatterX,
      y: y + (fxRand(sys) - 0.5) * scatterY,
      vx,
      vy,
      age: 0,
      life: spec.life[0] + fxRand(sys) * (spec.life[1] - spec.life[0]),
      size: (spec.size[0] + fxRand(sys) * (spec.size[1] - spec.size[0])) * sizeMul,
      gravity: spec.gravity,
      drag: spec.drag,
      rot: fxRand(sys) * Math.PI * 2,
      vrot: (fxRand(sys) - 0.5) * 2 * spec.vrot,
      shape: spec.shapes[Math.floor(fxRand(sys) * spec.shapes.length) % spec.shapes.length],
      color: opts.color ?? pickPalette(opts.colors ?? spec.colors, sys),
    });
  }
  return n;
}

export function spawnBurst(
  sys: FxSystem,
  kind: FxBurstKind,
  x: number,
  y: number,
  opts: { dirX?: number; color?: string; colors?: string[] } = {},
): number {
  const spec = BURSTS[kind];
  return emitBurst(sys, spec, x, y, {
    count: spec.count,
    dirX: opts.dirX,
    color: opts.color,
    colors: opts.colors,
  });
}

const MATERIAL_PALETTES: readonly (readonly [string, readonly string[]])[] = [
  ["mithril", ["#bfeef2", "#7fd4dc", "#e8ffff", "#4fa8b8"]],
  ["crystal", ["#e6dcff", "#b79cff", "#ffffff", "#8f7fe0"]],
  ["diamond", ["#e8ffff", "#bfeef2", "#ffffff", "#9fd8e8"]],
  ["ruby", ["#ff8fa0", "#e5484d", "#ffd3d8", "#a02430"]],
  ["sapphire", ["#8fb8ff", "#3a6fd8", "#d3e4ff", "#244a96"]],
  ["emerald", ["#8fe8b0", "#2fae5f", "#d8ffdf", "#1c7a42"]],
  ["rare", ["#e6dcff", "#ffd23e", "#bfeef2", "#ffffff"]],
  ["gold", ["#ffd23e", "#f5b921", "#fff3b0", "#c8890a"]],
  ["copper", ["#e08a4c", "#b05f2a", "#f2c094", "#7a3f1c"]],
  ["iron", ["#c9cdd4", "#8d939e", "#eef1f5", "#5c626c"]],
  ["coal", ["#3c3c42", "#232327", "#5c5c64", "#101013"]],
  ["sulfur", ["#ffe14d", "#f2c41c", "#fff7ae", "#d19a06"]],
  ["glass", ["#dff6ff", "#a8dcf0", "#ffffff", "#7cc0e8"]],
  ["chest", ["#ffd23e", "#c89b62", "#fff3b0", "#8a5a2b"]],
  ["berry", ["#e5484d", "#a8327a", "#ffb3b8", "#7a1f24"]],
  ["beehive", ["#ffb52e", "#f59e0b", "#ffd97a", "#c87f0a"]],
  ["honey", ["#ffb52e", "#f59e0b", "#ffd97a", "#c87f0a"]],
  ["mushroom", ["#e8e0d0", "#c96f4a", "#fff6e8", "#8d5a3a"]],
  ["flower", ["#ffb7d5", "#ff8fb8", "#fff0f6", "#e56aa0"]],
  ["herb", ["#69b84a", "#3e7d2c", "#cfe89a", "#8a5a2b"]],
  ["nest", ["#d8b36a", "#a87f3f", "#f2dda6", "#7a5a24"]],
  ["driftwood", ["#c9b18a", "#9a7b4f", "#e8dcc2", "#6b543a"]],
  ["log", ["#8a5a2b", "#5d3a17", "#c89b62", "#2f6121"]],
  ["wood", ["#8a5a2b", "#5d3a17", "#c89b62", "#2f6121"]],
  ["stone", ["#8d8d93", "#55555c", "#c9c9cf", "#3c3c42"]],
  ["rock", ["#8d8d93", "#55555c", "#c9c9cf", "#3c3c42"]],
];

export function burstPaletteFor(id: string | null | undefined): string[] | null {
  if (!id) return null;
  for (const [key, palette] of MATERIAL_PALETTES) {
    if (id.includes(key)) return [...palette];
  }
  return null;
}

export type FxAmbientKind = "snow" | "leaf" | "pollen" | "firefly" | "rain";

export function ambientKindFor(tile: number, isTree: boolean, night: number): FxAmbientKind {
  if (tile === 6 || tile === 7) return "snow";
  if (isTree) return "leaf";
  if (night > 0.45) return "firefly";
  return "pollen";
}

export type FxWeather = "clear" | "rain";

export const WEATHER_PERIOD_SEC = 360;

export function weatherAt(unixSec: number): FxWeather {
  const idx = Math.floor(unixSec / WEATHER_PERIOD_SEC);
  let h = idx | 0;
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489917);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296 < 0.35 ? "rain" : "clear";
}

export const WEATHER_BLEND_SEC = 30;

export function weatherBlendAt(unixSec: number): { weather: FxWeather; rainStrength: number } {
  const cur = weatherAt(unixSec);
  const idx = Math.floor(unixSec / WEATHER_PERIOD_SEC);
  const elapsed = unixSec - idx * WEATHER_PERIOD_SEC;
  if (elapsed >= WEATHER_BLEND_SEC) return { weather: cur, rainStrength: cur === "rain" ? 1 : 0 };
  const prev = weatherAt((idx - 1) * WEATHER_PERIOD_SEC + 1);
  if (prev === cur) return { weather: cur, rainStrength: cur === "rain" ? 1 : 0 };
  const k = elapsed / WEATHER_BLEND_SEC;
  return { weather: cur, rainStrength: cur === "rain" ? k : 1 - k };
}

export function weatherAmbientKind(
  weather: FxWeather,
  tile: number,
  isTree: boolean,
  night: number,
): FxAmbientKind {
  if (tile === 6 || tile === 7) return "snow";
  if (weather === "rain") return "rain";
  return ambientKindFor(tile, isTree, night);
}

export type FxPhaseKind = "day" | "dusk" | "night" | "dawn";

export function phaseKind(phase: number): FxPhaseKind {
  let p = phase % 1;
  if (p < 0) p += 1;
  if (p >= 0.18 && p < 0.3) return "dawn";
  if (p >= 0.3 && p < 0.68) return "day";
  if (p >= 0.68 && p < 0.86) return "dusk";
  return "night";
}

const AMBIENT_SPEC: Record<
  FxAmbientKind,
  {
    colors: string[];
    size: [number, number];
    life: [number, number];
    fall: [number, number];
    sway: number;
  }
> = {
  snow: {
    colors: ["#ffffff", "#e8f1f7"],
    size: [0.03, 0.07],
    life: [1.6, 2.8],
    fall: [0.5, 0.9],
    sway: 0.5,
  },
  leaf: {
    colors: ["#69b84a", "#3e7d2c", "#a8c256"],
    size: [0.05, 0.1],
    life: [1.4, 2.4],
    fall: [0.35, 0.65],
    sway: 0.8,
  },
  pollen: {
    colors: ["#fff3b0", "#ffe98a"],
    size: [0.02, 0.045],
    life: [1.8, 3.0],
    fall: [0.06, 0.16],
    sway: 0.35,
  },
  firefly: {
    colors: ["#d8ffb0", "#aef29a"],
    size: [0.03, 0.055],
    life: [1.6, 2.6],
    fall: [-0.05, 0.05],
    sway: 0.6,
  },
  rain: {
    colors: ["#7cc0e8", "#a8d4f0", "#3a7cb4"],
    size: [0.03, 0.06],
    life: [0.9, 1.4],
    fall: [7, 10],
    sway: 0.4,
  },
};

export function spawnAmbient(
  sys: FxSystem,
  kind: FxAmbientKind,
  x0: number,
  x1: number,
  y0: number,
): FxParticle | null {
  if (sys.intensity <= 0) return null;
  const spec = AMBIENT_SPEC[kind];
  const p: FxParticle = {
    x: x0 + fxRand(sys) * Math.max(0.1, x1 - x0),
    y: y0 - 0.3,
    vx: (fxRand(sys) - 0.5) * spec.sway,
    vy: spec.fall[0] + fxRand(sys) * (spec.fall[1] - spec.fall[0]),
    age: 0,
    life: spec.life[0] + fxRand(sys) * (spec.life[1] - spec.life[0]),
    size: spec.size[0] + fxRand(sys) * (spec.size[1] - spec.size[0]),
    gravity: 0,
    drag: 0,
    rot: fxRand(sys) * Math.PI * 2,
    vrot: (fxRand(sys) - 0.5) * 3,
    shape: kind === "snow" ? "snow" : kind === "leaf" ? "leaf" : kind === "rain" ? "spark" : "glow",
    color: spec.colors[Math.floor(fxRand(sys) * spec.colors.length) % spec.colors.length],
  };
  pushParticle(sys, p);
  return p;
}

export type FxShake = { amp: number; startedAt: number; durationMs: number };

export function createShake(): FxShake {
  return { amp: 0, startedAt: 0, durationMs: 0 };
}

export function startShake(shake: FxShake, amp: number, nowMs: number, durationMs = 180): FxShake {
  const remain = shake.durationMs > 0 ? 1 - (nowMs - shake.startedAt) / shake.durationMs : 0;
  if (remain > 0 && shake.amp * remain >= amp) return shake;
  return { amp: Math.max(0, amp), startedAt: nowMs, durationMs: Math.max(1, durationMs) };
}

export function shakeOffsetAt(shake: FxShake, nowMs: number): { x: number; y: number } {
  if (shake.amp <= 0 || shake.durationMs <= 0) return { x: 0, y: 0 };
  const k = (nowMs - shake.startedAt) / shake.durationMs;
  if (k < 0 || k >= 1) return { x: 0, y: 0 };
  const decay = (1 - k) * (1 - k);
  const t = nowMs / 16.7;
  return {
    x: Math.sin(t * 2.7) * shake.amp * decay,
    y: Math.cos(t * 3.4) * shake.amp * decay * 0.7,
  };
}

export function popScale(k: number): number {
  const c = k < 0 ? 0 : k > 1 ? 1 : k;
  if (c >= 1) return 1;
  return 1 - 0.45 * Math.exp(-3.5 * c) * Math.cos(9 * c);
}

export function popProgress(startedAt: number, nowMs: number, durationMs = 240): number {
  if (durationMs <= 0) return 1;
  const k = (nowMs - startedAt) / durationMs;
  return k < 0 ? 0 : k > 1 ? 1 : k;
}

export const SWING_DURATION_MS = 230;

export function swingProgress(startedAt: number, nowMs: number): number {
  if (startedAt <= 0) return 1;
  const k = (nowMs - startedAt) / SWING_DURATION_MS;
  return k < 0 ? 0 : k > 1 ? 1 : k;
}

export const WHIFF_ALPHA_SCALE = 0.45;

export function slashAlpha(k: number): number {
  const c = k < 0 ? 0 : k > 1 ? 1 : k;
  if (c < 0.25) return c / 0.25;
  return Math.max(0, 1 - (c - 0.25) / 0.5);
}

export type SkillFxKind = "warp";

export type SkillFxEffect = {
  kind: SkillFxKind;
  x: number;
  y: number;
  fromX: number;
  fromY: number;
  startedAt: number;
  seed: number;
};

export const SKILL_FX_DURATION_MS: Record<SkillFxKind, number> = {
  warp: 1200,
};

export function skillFxProgress(effect: SkillFxEffect, nowMs: number): number {
  return (nowMs - effect.startedAt) / SKILL_FX_DURATION_MS[effect.kind];
}

export function skillFxStage(effect: SkillFxEffect, nowMs: number): number {
  const p = skillFxProgress(effect, nowMs);
  return p < 0.15 ? 0 : 1;
}

export function spawnSkillFx(sys: FxSystem, effect: SkillFxEffect, stage: number): void {
  const { x, y } = effect;
  if (stage === 1) {
    spawnBurst(sys, "warp", x, y);
    spawnBurst(sys, "warp", x, y);
  }
}
