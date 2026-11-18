import type { FxBurstKind } from "./fx";

export type WbBgmScene =
  | "field-day"
  | "field-night"
  | "lobby"
  | "casino"
  | "cave"
  | "dungeon"
  | "ruins";

export function bgmSceneFor(input: {
  space: string;
  night: number;
  casinoOpen: boolean;
}): WbBgmScene {
  if (input.casinoOpen) return "casino";
  if (input.space.startsWith("cave:")) return "cave";
  if (input.space.startsWith("dungeon:")) return "dungeon";
  if (input.space.startsWith("ruins:")) return "ruins";
  if (input.space !== "world") return "lobby";
  return input.night > 0.5 ? "field-night" : "field-day";
}

export type WbBgmTrack = {
  bpm: number;
  root: number;
  scale: number[];
  bass: (number | null)[];
  lead: (number | null)[];
  hat: boolean[];
  kick: boolean[];
};

export const BGM_STEPS = 32;

export function semitoneFreq(root: number, semitone: number): number {
  return root * Math.pow(2, semitone / 12);
}

export function degreeFreq(track: WbBgmTrack, degree: number, octave = 0): number {
  const idx = Math.max(0, Math.min(track.scale.length - 1, Math.floor(degree)));
  return semitoneFreq(track.root, track.scale[idx] + octave * 12);
}

const MAJOR_PENT = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
const MINOR_PENT = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24];

function hatEvery(...steps: number[]): boolean[] {
  const hat = new Array<boolean>(BGM_STEPS).fill(false);
  for (const s of steps) hat[s % BGM_STEPS] = true;
  return hat;
}

function barSteps(perBar: number[]): boolean[] {
  const out = new Array<boolean>(BGM_STEPS).fill(false);
  for (let bar = 0; bar < 4; bar++) for (const s of perBar) out[bar * 8 + s] = true;
  return out;
}

function bassLine(barRoots: number[]): (number | null)[] {
  const bass = new Array<number | null>(BGM_STEPS).fill(null);
  barRoots.forEach((rootSemi, bar) => {
    bass[bar * 8] = rootSemi;
    bass[bar * 8 + 4] = rootSemi;
    bass[bar * 8 + 6] = rootSemi + 7;
  });
  return bass;
}

export const BGM_TRACKS: Record<WbBgmScene, WbBgmTrack> = {
  "field-day": {
    bpm: 104,
    root: 261.63, // C4
    scale: MAJOR_PENT,
    bass: bassLine([0, 5, 0, 7]),
    lead: [
      4,
      null,
      2,
      null,
      3,
      null,
      2,
      null,
      1,
      null,
      2,
      null,
      3,
      null,
      null,
      null,
      4,
      null,
      5,
      null,
      4,
      3,
      2,
      null,
      3,
      null,
      2,
      null,
      1,
      null,
      0,
      null,
    ],
    hat: barSteps([2, 6]),
    kick: barSteps([0, 4]),
  },
  "field-night": {
    bpm: 76,
    root: 220.0, // A3
    scale: MINOR_PENT,
    bass: bassLine([0, 8, 3, 10]),
    lead: [
      4,
      null,
      null,
      null,
      3,
      null,
      null,
      null,
      2,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      4,
      null,
      null,
      null,
      5,
      null,
      4,
      null,
      3,
      null,
      null,
      null,
      2,
      null,
      null,
      null,
    ],
    hat: hatEvery(),
    kick: hatEvery(),
  },
  lobby: {
    bpm: 96,
    root: 174.61, // F3（リードは 1 オクターブ上で鳴らす想定の基準）
    scale: MAJOR_PENT,
    bass: bassLine([0, 5, 0, 7]),
    lead: [
      2,
      null,
      3,
      null,
      4,
      null,
      null,
      null,
      3,
      null,
      2,
      null,
      1,
      null,
      2,
      null,
      2,
      null,
      3,
      null,
      4,
      null,
      5,
      null,
      4,
      null,
      3,
      null,
      2,
      null,
      null,
      null,
    ],
    hat: barSteps([1, 3, 5, 7]),
    kick: barSteps([0, 4]),
  },
  cave: {
    bpm: 72,
    root: 220.0, // A3
    scale: MINOR_PENT,
    bass: bassLine([0, 3]),
    lead: [
      4,
      null,
      null,
      null,
      3,
      null,
      null,
      null,
      null,
      null,
      2,
      null,
      null,
      null,
      null,
      null,
      3,
      null,
      null,
      null,
      4,
      null,
      null,
      5,
      null,
      null,
      null,
      null,
      2,
      null,
      null,
      null,
    ],
    hat: hatEvery(),
    kick: hatEvery(),
  },
  dungeon: {
    bpm: 96,
    root: 146.83, // D3
    scale: MINOR_PENT,
    bass: bassLine([0, 0, 5, 3]),
    lead: [
      4,
      null,
      4,
      null,
      3,
      null,
      2,
      null,
      4,
      null,
      null,
      null,
      5,
      null,
      4,
      3,
      2,
      null,
      2,
      null,
      3,
      null,
      4,
      null,
      null,
      null,
      3,
      null,
      2,
      null,
      null,
      null,
    ],
    hat: hatEvery(),
    kick: barSteps([0, 4]),
  },
  ruins: {
    bpm: 84,
    root: 164.81, // E3
    scale: MINOR_PENT,
    bass: bassLine([0, 10, 5, 8]),
    lead: [
      4,
      null,
      null,
      null,
      null,
      null,
      3,
      null,
      null,
      null,
      2,
      null,
      null,
      null,
      null,
      null,
      5,
      null,
      null,
      null,
      4,
      null,
      null,
      null,
      3,
      null,
      null,
      null,
      2,
      null,
      null,
      null,
    ],
    hat: barSteps([3, 7]),
    kick: hatEvery(),
  },
  casino: {
    bpm: 132,
    root: 293.66, // D4
    scale: MAJOR_PENT,
    bass: (() => {
      const bass = new Array<number | null>(BGM_STEPS).fill(null);
      [0, 5, 7, 5].forEach((rootSemi, bar) => {
        for (const s of [0, 2, 4, 6]) bass[bar * 8 + s] = rootSemi + (s % 4 === 2 ? 12 : 0);
      });
      return bass;
    })(),
    lead: [
      4,
      3,
      4,
      null,
      5,
      4,
      3,
      null,
      2,
      3,
      4,
      null,
      3,
      2,
      1,
      null,
      4,
      3,
      4,
      null,
      5,
      6,
      5,
      4,
      3,
      null,
      2,
      null,
      1,
      null,
      0,
      null,
    ],
    hat: barSteps([0, 1, 2, 3, 4, 5, 6, 7]),
    kick: barSteps([0, 2, 4, 6]),
  },
};

export function leadNoteCount(track: WbBgmTrack): number {
  return track.lead.filter((n) => n !== null).length;
}

export type WbSeName =
  | "chop"
  | "mine"
  | "till"
  | "plant"
  | "harvest"
  | "place"
  | "build"
  | "debris"
  | "splash"
  | "step"
  | "dash"
  | "warp"
  | "poof"
  | "swing"
  | "hit"
  | "kill"
  | "hurt"
  | "coin"
  | "buy"
  | "sell"
  | "craft"
  | "open"
  | "close"
  | "click"
  | "error"
  | "success"
  | "note";

export type WbSeTier = 1 | 2 | 3 | 4 | 5;

export const WB_SE_TIER_GAIN: Record<WbSeTier, number> = {
  1: 0.22,
  2: 0.16,
  3: 0.12,
  4: 0.08,
  5: 0.04,
};

export const WB_SE_TIERS: Record<WbSeName, WbSeTier> = {
  kill: 1,
  success: 1,
  hit: 2,
  hurt: 2,
  coin: 2,
  error: 2,
  chop: 3,
  mine: 3,
  till: 3,
  plant: 3,
  harvest: 3,
  place: 3,
  build: 3,
  debris: 3,
  splash: 3,
  warp: 3,
  buy: 3,
  sell: 3,
  craft: 3,
  note: 3,
  swing: 4,
  dash: 4,
  poof: 4,
  open: 4,
  close: 4,
  click: 4,
  step: 5,
};

export const WB_SE_MIN_INTERVAL_MS: Partial<Record<WbSeName, number>> = {
  step: 110,
  dash: 140,
  swing: 90,
  splash: 120,
  hit: 60,
  kill: 150,
  coin: 90,
  success: 150,
  note: 60,
};

export function seForFxBurst(kind: FxBurstKind): WbSeName {
  switch (kind) {
    case "death":
      return "kill";
    case "spawn":
      return "poof";
    case "hit":
      return "hit";
    default:
      return kind;
  }
}

export type FootstepMaterial = "grass" | "stone" | "wood" | "snow" | "sand" | "water";

export function footstepMaterialFor(input: {
  biome?: string;
  space?: string;
  swimming?: boolean;
}): FootstepMaterial {
  if (input.swimming) return "water";
  const space = input.space ?? "world";
  if (space === "tent") return "wood";
  if (space === "lobby" || space === "lobby2" || space === "lobby3") return "stone";
  if (space.startsWith("cave:") || space.startsWith("dungeon:") || space.startsWith("ruins:"))
    return "stone";
  switch (input.biome) {
    case "snowfield":
    case "snow_forest":
      return "snow";
    case "beach":
    case "dryland":
      return "sand";
    case "lake":
    case "wetland":
      return "water";
    case "highland":
      return "stone";
    default:
      return "grass";
  }
}

export const SE_DISTANCE_MAX_TILES = 12;
export const SE_DISTANCE_MIN_GAIN = 0.15;

export function distanceGain(distanceTiles: number): number {
  if (distanceTiles <= 0) return 1;
  return Math.max(SE_DISTANCE_MIN_GAIN, 1 - distanceTiles / SE_DISTANCE_MAX_TILES);
}

export function seVariation(): { pitch: number; gain: number } {
  return { pitch: 0.94 + Math.random() * 0.12, gain: 0.92 + Math.random() * 0.16 };
}

export const SE_BURST_WINDOW_MS = 80;
export const SE_BURST_MAX = 6;

export type WbSoundSettings = { bgm: boolean; se: boolean };

const STORAGE_KEY = "worldbox-sound";
const SE_VOLUME = 0.9;
const BGM_VOLUME = 0.5;

let settings: WbSoundSettings = { bgm: true, se: true };
let settingsLoaded = false;

export function loadWbSoundSettings(): WbSoundSettings {
  if (settingsLoaded) return settings;
  settingsLoaded = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<WbSoundSettings>;
      settings = { bgm: parsed.bgm !== false, se: parsed.se !== false };
    }
  } catch {
    // 読めなければデフォルト（両方 ON）のまま
  }
  return settings;
}

export function saveWbSoundSettings(next: WbSoundSettings): void {
  settings = next;
  settingsLoaded = true;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 保存できなくても再生は続けられる
  }
  applySettings();
}

let ctx: AudioContext | null = null;
let seBus: GainNode | null = null;
let masterBus: GainNode | null = null;

export const BGM_CROSSFADE_MS = 1200;

function ensureCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    masterBus = ctx.createGain();
    masterBus.gain.value = 1;
    masterBus.connect(ctx.destination);
    seBus = ctx.createGain();
    seBus.gain.value = settings.se ? SE_VOLUME : 0;
    seBus.connect(masterBus);
  }
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  return ctx;
}

export function unlockWbAudio(): void {
  loadWbSoundSettings();
  if (!ensureCtx()) return;
  if (settings.bgm && currentScene && !activeVoice) startVoice(currentScene);
}

function applySettings(): void {
  if (!ctx || !seBus) return;
  seBus.gain.setTargetAtTime(settings.se ? SE_VOLUME : 0, ctx.currentTime, 0.03);
  if (settings.bgm) {
    if (currentScene && !activeVoice) startVoice(currentScene);
  } else {
    fadeOutVoice(activeVoice);
    activeVoice = null;
  }
}

let sePitch = 1;
let seGain = 1;

function tone(opts: {
  freq: number;
  freqEnd?: number;
  dur: number;
  type?: OscillatorType;
  gain?: number;
  at?: number;
  dest?: AudioNode;
}): void {
  if (!ctx || !seBus) return;
  const t = opts.at ?? ctx.currentTime;
  const isSe = opts.dest === undefined;
  const pitch = isSe ? sePitch : 1;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = opts.type ?? "triangle";
  osc.frequency.setValueAtTime(Math.max(20, opts.freq * pitch), t);
  if (opts.freqEnd)
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.freqEnd * pitch), t + opts.dur);
  const peak = (opts.gain ?? 0.2) * (isSe ? seGain : 1);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
  osc.connect(g);
  g.connect(opts.dest ?? seBus);
  osc.start(t);
  osc.stop(t + opts.dur + 0.05);
}

let noiseBuffer: AudioBuffer | null = null;

function noise(opts: {
  dur: number;
  gain?: number;
  at?: number;
  type?: BiquadFilterType;
  filterFrom?: number;
  filterTo?: number;
  dest?: AudioNode;
}): void {
  if (!ctx || !seBus) return;
  const t = opts.at ?? ctx.currentTime;
  if (!noiseBuffer) {
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  const isSe = opts.dest === undefined;
  const pitch = isSe ? sePitch : 1;
  filter.type = opts.type ?? "bandpass";
  filter.Q.value = 0.9;
  filter.frequency.setValueAtTime((opts.filterFrom ?? 1800) * pitch, t);
  if (opts.filterTo)
    filter.frequency.exponentialRampToValueAtTime(
      Math.max(30, opts.filterTo * pitch),
      t + opts.dur,
    );
  const g = ctx.createGain();
  const peak = (opts.gain ?? 0.16) * (isSe ? seGain : 1);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
  src.connect(filter);
  filter.connect(g);
  g.connect(opts.dest ?? seBus);
  src.start(t, Math.random() * 0.4);
  src.stop(t + opts.dur + 0.05);
}

function pluck(freq: number, at: number, gain: number, dest: AudioNode, dur = 0.32): void {
  if (!ctx) return;
  tone({ freq, dur, type: "triangle", gain, at, dest });
  tone({ freq: freq * 2, dur: dur * 0.5, type: "sine", gain: gain * 0.35, at, dest });
}

function tierGain(name: WbSeName, local = 1): number {
  return WB_SE_TIER_GAIN[WB_SE_TIERS[name]] * local;
}

const STEP_MATERIAL_NOISE: Record<
  FootstepMaterial,
  { dur: number; gain: number; type: BiquadFilterType; from: number; to?: number }
> = {
  grass: { dur: 0.05, gain: 1.4, type: "lowpass", from: 700 },
  stone: { dur: 0.04, gain: 1.1, type: "bandpass", from: 1900 },
  wood: { dur: 0.06, gain: 1.2, type: "bandpass", from: 950 },
  snow: { dur: 0.09, gain: 1.2, type: "lowpass", from: 420 },
  sand: { dur: 0.07, gain: 1.3, type: "bandpass", from: 1100 },
  water: { dur: 0.1, gain: 1.2, type: "bandpass", from: 900, to: 2200 },
};

let currentStepMaterial: FootstepMaterial = "grass";

const SE_RECIPES: Record<WbSeName, (t: number) => void> = {
  chop: (t) => {
    tone({
      freq: 190,
      freqEnd: 90,
      dur: 0.1,
      type: "triangle",
      gain: tierGain("chop", 1.4),
      at: t,
    });
    noise({ dur: 0.09, gain: tierGain("chop"), at: t, type: "lowpass", filterFrom: 1100 });
  },
  mine: (t) => {
    tone({ freq: 2350, dur: 0.05, type: "square", gain: tierGain("mine", 0.5), at: t });
    tone({
      freq: 320,
      freqEnd: 140,
      dur: 0.07,
      type: "triangle",
      gain: tierGain("mine", 1.2),
      at: t,
    });
    noise({ dur: 0.05, gain: tierGain("mine", 0.8), at: t, type: "highpass", filterFrom: 2800 });
  },
  till: (t) => {
    noise({
      dur: 0.16,
      gain: tierGain("till", 1.3),
      at: t,
      type: "lowpass",
      filterFrom: 620,
      filterTo: 300,
    });
    tone({ freq: 120, freqEnd: 70, dur: 0.12, type: "sine", gain: tierGain("till"), at: t });
  },
  plant: (t) => {
    noise({ dur: 0.08, gain: tierGain("plant"), at: t, type: "lowpass", filterFrom: 800 });
    tone({ freq: 660, dur: 0.09, type: "triangle", gain: tierGain("plant", 0.8), at: t + 0.05 });
    tone({ freq: 880, dur: 0.12, type: "triangle", gain: tierGain("plant", 0.8), at: t + 0.11 });
  },
  harvest: (t) => {
    [523.25, 659.25, 783.99].forEach((f, i) =>
      tone({ freq: f, dur: 0.14, type: "triangle", gain: tierGain("harvest"), at: t + i * 0.055 }),
    );
  },
  place: (t) => {
    tone({ freq: 165, freqEnd: 80, dur: 0.11, type: "sine", gain: tierGain("place", 1.5), at: t });
    noise({ dur: 0.09, gain: tierGain("place", 0.8), at: t, type: "lowpass", filterFrom: 900 });
  },
  build: (t) => {
    tone({
      freq: 210,
      freqEnd: 110,
      dur: 0.07,
      type: "triangle",
      gain: tierGain("build", 1.2),
      at: t,
    });
    tone({
      freq: 180,
      freqEnd: 95,
      dur: 0.08,
      type: "triangle",
      gain: tierGain("build", 1.2),
      at: t + 0.09,
    });
    tone({ freq: 523, dur: 0.12, type: "triangle", gain: tierGain("build", 0.7), at: t + 0.18 });
  },
  debris: (t) => {
    noise({ dur: 0.18, gain: tierGain("debris", 1.2), at: t, filterFrom: 1600, filterTo: 400 });
    tone({
      freq: 240,
      freqEnd: 60,
      dur: 0.2,
      type: "triangle",
      gain: tierGain("debris"),
      at: t + 0.02,
    });
  },
  splash: (t) => {
    noise({ dur: 0.22, gain: tierGain("splash", 1.2), at: t, filterFrom: 900, filterTo: 2400 });
    tone({
      freq: 740,
      freqEnd: 1180,
      dur: 0.07,
      type: "sine",
      gain: tierGain("splash", 0.6),
      at: t + 0.06,
    });
    tone({
      freq: 620,
      freqEnd: 990,
      dur: 0.07,
      type: "sine",
      gain: tierGain("splash", 0.5),
      at: t + 0.13,
    });
  },
  step: (t) => {
    const m = STEP_MATERIAL_NOISE[currentStepMaterial];
    noise({
      dur: m.dur,
      gain: tierGain("step", m.gain),
      at: t,
      type: m.type,
      filterFrom: m.from,
      filterTo: m.to,
    });
    if (currentStepMaterial === "stone") {
      tone({ freq: 1450, dur: 0.025, type: "square", gain: tierGain("step", 0.5), at: t });
    } else if (currentStepMaterial === "wood") {
      tone({
        freq: 320,
        freqEnd: 180,
        dur: 0.05,
        type: "triangle",
        gain: tierGain("step", 0.9),
        at: t,
      });
    }
  },
  dash: (t) => {
    noise({ dur: 0.16, gain: tierGain("dash", 1.4), at: t, filterFrom: 500, filterTo: 2100 });
  },
  warp: (t) => {
    [440, 587, 880, 1175].forEach((f, i) =>
      tone({ freq: f, dur: 0.09, type: "square", gain: tierGain("warp", 0.45), at: t + i * 0.045 }),
    );
  },
  poof: (t) => {
    noise({
      dur: 0.14,
      gain: tierGain("poof", 1.2),
      at: t,
      type: "lowpass",
      filterFrom: 1000,
      filterTo: 300,
    });
  },
  swing: (t) => {
    noise({ dur: 0.11, gain: tierGain("swing", 1.6), at: t, filterFrom: 3200, filterTo: 700 });
  },
  hit: (t) => {
    tone({
      freq: 210,
      freqEnd: 65,
      dur: 0.12,
      type: "triangle",
      gain: tierGain("hit", 1.3),
      at: t,
    });
    noise({ dur: 0.06, gain: tierGain("hit", 0.8), at: t, filterFrom: 2400 });
  },
  kill: (t) => {
    tone({ freq: 160, freqEnd: 40, dur: 0.3, type: "sine", gain: tierGain("kill", 1.2), at: t });
    noise({ dur: 0.2, gain: tierGain("kill", 0.8), at: t, type: "lowpass", filterFrom: 900 });
    tone({ freq: 784, dur: 0.1, type: "triangle", gain: tierGain("kill", 0.6), at: t + 0.08 });
    tone({ freq: 1047, dur: 0.16, type: "triangle", gain: tierGain("kill", 0.6), at: t + 0.15 });
  },
  hurt: (t) => {
    tone({ freq: 150, freqEnd: 90, dur: 0.16, type: "square", gain: tierGain("hurt", 0.7), at: t });
  },
  coin: (t) => {
    tone({ freq: 2093, dur: 0.08, type: "sine", gain: tierGain("coin", 0.8), at: t });
    tone({ freq: 2637, dur: 0.14, type: "sine", gain: tierGain("coin", 0.8), at: t + 0.05 });
  },
  buy: (t) => {
    tone({ freq: 2093, dur: 0.08, type: "sine", gain: tierGain("buy", 0.8), at: t });
    tone({ freq: 2637, dur: 0.14, type: "sine", gain: tierGain("buy", 0.8), at: t + 0.05 });
    tone({ freq: 784, dur: 0.12, type: "triangle", gain: tierGain("buy", 0.7), at: t + 0.12 });
  },
  sell: (t) => {
    tone({ freq: 784, dur: 0.1, type: "triangle", gain: tierGain("sell", 0.8), at: t });
    tone({ freq: 2093, dur: 0.08, type: "sine", gain: tierGain("sell", 0.7), at: t + 0.09 });
    tone({ freq: 2637, dur: 0.13, type: "sine", gain: tierGain("sell", 0.7), at: t + 0.14 });
  },
  craft: (t) => {
    tone({
      freq: 200,
      freqEnd: 110,
      dur: 0.07,
      type: "triangle",
      gain: tierGain("craft", 1.2),
      at: t,
    });
    tone({ freq: 659, dur: 0.12, type: "triangle", gain: tierGain("craft", 0.8), at: t + 0.09 });
    tone({ freq: 880, dur: 0.16, type: "triangle", gain: tierGain("craft", 0.8), at: t + 0.17 });
  },
  open: (t) => {
    tone({ freq: 587, dur: 0.07, type: "triangle", gain: tierGain("open"), at: t });
    tone({ freq: 880, dur: 0.1, type: "triangle", gain: tierGain("open", 0.9), at: t + 0.05 });
  },
  close: (t) => {
    tone({ freq: 880, dur: 0.06, type: "triangle", gain: tierGain("close"), at: t });
    tone({ freq: 587, dur: 0.09, type: "triangle", gain: tierGain("close", 0.9), at: t + 0.04 });
  },
  click: (t) => {
    tone({ freq: 1050, dur: 0.035, type: "square", gain: tierGain("click", 0.7), at: t });
  },
  error: (t) => {
    tone({ freq: 165, dur: 0.11, type: "square", gain: tierGain("error", 0.6), at: t });
    tone({ freq: 165, dur: 0.15, type: "square", gain: tierGain("error", 0.6), at: t + 0.14 });
  },
  success: (t) => {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      tone({
        freq: f,
        dur: 0.18,
        type: "triangle",
        gain: tierGain("success", 0.8),
        at: t + i * 0.07,
      }),
    );
  },
  note: (t) => {
    tone({ freq: 523.25, dur: 0.5, type: "triangle", gain: tierGain("note", 1.1), at: t });
    tone({ freq: 523.25 * 2, dur: 0.25, type: "sine", gain: tierGain("note", 0.4), at: t });
    tone({ freq: 523.25 * 3, dur: 0.12, type: "sine", gain: tierGain("note", 0.15), at: t });
  },
};

const lastPlayedAt = new Map<WbSeName, number>();
const recentSeTimes: number[] = [];

export type WbSeOptions = {
  pitch?: number;
  gain?: number;
  distance?: number;
  material?: FootstepMaterial;
};

export function playPianoNotes(semitones: readonly number[]): void {
  loadWbSoundSettings();
  if (!settings.se || !ctx || !seBus) return;
  const notes = semitones.filter((n) => Number.isInteger(n) && n >= -24 && n <= 24).slice(0, 12);
  if (notes.length === 0) return;
  try {
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    seGain = 1;
    for (const n of notes) {
      sePitch = Math.pow(2, n / 12);
      SE_RECIPES.note(ctx.currentTime + 0.01);
    }
  } catch {
    // 音が出ない環境でもゲームは止めない
  } finally {
    sePitch = 1;
    seGain = 1;
  }
}

export function playWbSe(name: WbSeName, opts: WbSeOptions = {}): void {
  loadWbSoundSettings();
  if (!settings.se || !ctx || !seBus) return;
  const now = performance.now();
  const minInterval = WB_SE_MIN_INTERVAL_MS[name];
  if (minInterval) {
    const last = lastPlayedAt.get(name) ?? 0;
    if (now - last < minInterval) return;
    lastPlayedAt.set(name, now);
  }
  while (recentSeTimes.length > 0 && now - recentSeTimes[0] > SE_BURST_WINDOW_MS)
    recentSeTimes.shift();
  if (recentSeTimes.length >= SE_BURST_MAX && WB_SE_TIERS[name] >= 4) return;
  recentSeTimes.push(now);
  const variation = seVariation();
  const pitch = opts.pitch ?? variation.pitch;
  const gain = (opts.gain ?? variation.gain) * distanceGain(opts.distance ?? 0);
  try {
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    sePitch = pitch;
    seGain = gain;
    if (name === "step") currentStepMaterial = opts.material ?? "grass";
    SE_RECIPES[name](ctx.currentTime + 0.01);
  } catch {
    // 音が出ない環境でもゲームは止めない
  } finally {
    sePitch = 1;
    seGain = 1;
  }
}

export function playWbStep(material: FootstepMaterial): void {
  playWbSe("step", { material });
}

let currentScene: WbBgmScene | null = null;
type BgmVoice = {
  scene: WbBgmScene;
  gain: GainNode;
  timer: ReturnType<typeof setInterval> | null;
  step: number;
  nextStepAt: number;
};
let activeVoice: BgmVoice | null = null;
let bgmWasPlayingBeforeHidden = false;

function scheduleStep(track: WbBgmTrack, step: number, at: number, dest: AudioNode): void {
  if (!ctx) return;
  const bassSemi = track.bass[step];
  if (bassSemi !== null) {
    tone({
      freq: semitoneFreq(track.root / 2, bassSemi),
      dur: 0.34,
      type: "triangle",
      gain: 0.16,
      at,
      dest,
    });
  }
  const leadDegree = track.lead[step];
  if (leadDegree !== null) {
    pluck(degreeFreq(track, leadDegree), at, 0.14, dest);
  }
  if (track.hat[step]) {
    noise({ dur: 0.03, gain: 0.028, at, type: "highpass", filterFrom: 6500, dest });
  }
  if (track.kick[step]) {
    tone({ freq: 120, freqEnd: 42, dur: 0.12, type: "sine", gain: 0.2, at, dest });
  }
}

function startVoice(scene: WbBgmScene): void {
  if (!ctx || !masterBus) return;
  const track = BGM_TRACKS[scene];
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(masterBus);
  const voice: BgmVoice = { scene, gain, timer: null, step: 0, nextStepAt: ctx.currentTime + 0.06 };
  const stepSec = 60 / track.bpm / 2;
  voice.timer = setInterval(() => {
    if (!ctx) return;
    if (voice.nextStepAt < ctx.currentTime - stepSec) {
      const missed = Math.ceil((ctx.currentTime - voice.nextStepAt) / stepSec);
      voice.step += missed;
      voice.nextStepAt += missed * stepSec;
    }
    while (voice.nextStepAt < ctx.currentTime + 0.28) {
      scheduleStep(track, voice.step % BGM_STEPS, voice.nextStepAt, voice.gain);
      voice.step += 1;
      voice.nextStepAt += stepSec;
    }
  }, 110);
  gain.gain.setTargetAtTime(BGM_VOLUME, ctx.currentTime, BGM_CROSSFADE_MS / 3000);
  activeVoice = voice;
}

function fadeOutVoice(voice: BgmVoice | null): void {
  if (!voice || !ctx) return;
  if (voice.timer) {
    clearInterval(voice.timer);
    voice.timer = null;
  }
  voice.gain.gain.setTargetAtTime(0, ctx.currentTime, BGM_CROSSFADE_MS / 3000);
  const gain = voice.gain;
  setTimeout(() => {
    try {
      gain.disconnect();
    } catch {
      // 既に外れていてもよい
    }
  }, BGM_CROSSFADE_MS + 400);
}

export function stopWbBgm(): void {
  fadeOutVoice(activeVoice);
  activeVoice = null;
  currentScene = null;
}

export function setWbBgmScene(scene: WbBgmScene | null): void {
  loadWbSoundSettings();
  if (scene === currentScene) return;
  if (scene === null) {
    stopWbBgm();
    return;
  }
  currentScene = scene;
  if (!settings.bgm || !ctx || !masterBus) return;
  fadeOutVoice(activeVoice);
  activeVoice = null;
  startVoice(scene);
}

export function currentWbBgmScene(): WbBgmScene | null {
  return currentScene;
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      bgmWasPlayingBeforeHidden = activeVoice !== null;
      fadeOutVoice(activeVoice);
      activeVoice = null;
    } else if (bgmWasPlayingBeforeHidden) {
      bgmWasPlayingBeforeHidden = false;
      if (settings.bgm && currentScene && ctx) startVoice(currentScene);
    }
  });
}
