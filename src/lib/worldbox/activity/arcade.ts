export type ArcadeCategory = "faceoff" | "party" | "realtime";

export type ArcadeEntry = {
  id: string;
  category: ArcadeCategory;
  order: number;
  sprite: string;
};

const entry = (id: string, category: ArcadeCategory, order: number): ArcadeEntry => ({
  id,
  category,
  order,
  sprite: `arcade_${id}`,
});

export const ARCADE_GAMES: readonly ArcadeEntry[] = [
  entry("reversi", "faceoff", 1),
  entry("connect4", "faceoff", 2),
  entry("battleship", "faceoff", 3),
  entry("territory", "faceoff", 4),
  entry("werewolf", "party", 1),
  entry("wordwolf", "party", 2),
  entry("majority", "party", 3),
  entry("drawguess", "party", 4),
  entry("daifugo", "party", 5),
  entry("babanuki", "party", 6),
  entry("quizbattle", "party", 7),
  entry("bombpass", "party", 8),
  entry("shiritori", "party", 9),
  entry("nanja", "party", 10),
  entry("liarsdice", "party", 11),
  entry("cheat", "party", 12),
  entry("hagetaka", "party", 13),
  entry("burst", "party", 14),
  entry("texas", "party", 15),
  entry("countdown", "party", 16),
  entry("musicalchairs", "party", 17),
  entry("wordbasket", "party", 18),
  entry("speed", "realtime", 1),
  entry("typerace", "realtime", 2),
  entry("calcrace", "realtime", 3),
  entry("stopbattle", "realtime", 4),
];

export const ARCADE_FIRST_WAVE: readonly string[] = [
  "reversi",
  "connect4",
  "battleship",
  "werewolf",
  "wordwolf",
  "majority",
];

export const ARCADE_SECOND_WAVE: readonly string[] = [
  "territory",
  "drawguess",
  "daifugo",
  "babanuki",
  "quizbattle",
  "bombpass",
  "shiritori",
  "nanja",
  "liarsdice",
  "cheat",
  "hagetaka",
  "burst",
  "texas",
  "countdown",
  "musicalchairs",
  "wordbasket",
  "speed",
  "typerace",
  "calcrace",
  "stopbattle",
];

export const ARCADE_SECOND_WAVE_2F: readonly string[] = [
  "territory",
  "drawguess",
  "daifugo",
  "babanuki",
  "quizbattle",
  "bombpass",
];

export const ARCADE_SECOND_WAVE_3F: readonly string[] = [
  "shiritori",
  "nanja",
  "liarsdice",
  "cheat",
  "hagetaka",
  "burst",
  "texas",
  "countdown",
  "musicalchairs",
  "wordbasket",
  "speed",
  "typerace",
  "calcrace",
  "stopbattle",
];

export function arcadeById(id: string): ArcadeEntry | undefined {
  if (typeof id !== "string") return undefined;
  return ARCADE_GAMES.find((e) => e.id === id);
}

export function arcadeByCategory(category: ArcadeCategory): ArcadeEntry[] {
  return ARCADE_GAMES.filter((e) => e.category === category).sort((a, b) => a.order - b.order);
}
