export const BOARD_MAX_POSTS = 30;
export const BOARD_TEXT_MAX = 120;
export const BOARD_NAME_MAX = 24;

export type BoardPost = {
  name: string;
  text: string;
  at: number;
};

export function sanitizeBoardText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  if (text.length === 0 || text.length > BOARD_TEXT_MAX) return null;
  return text;
}

function sanitizeBoardName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, BOARD_NAME_MAX);
}

export function parseBoardPost(raw: unknown): BoardPost | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  const text = sanitizeBoardText(v.text);
  if (text === null) return null;
  if (typeof v.at !== "number" || !Number.isFinite(v.at) || v.at <= 0) return null;
  const name = sanitizeBoardName(v.name);
  if (!name) return null;
  return { name, text, at: v.at };
}

export function parseBoardPosts(raw: unknown): BoardPost[] {
  let data: unknown = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(data)) return [];
  const posts: BoardPost[] = [];
  for (const item of data) {
    const post = parseBoardPost(item);
    if (post) posts.push(post);
  }
  posts.sort((a, b) => b.at - a.at);
  return posts.slice(0, BOARD_MAX_POSTS);
}

export function appendBoardPost(posts: readonly BoardPost[], post: BoardPost): BoardPost[] {
  return [post, ...posts].slice(0, BOARD_MAX_POSTS);
}
