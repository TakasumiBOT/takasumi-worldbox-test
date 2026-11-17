"use client";
// 移行版の差分（本家との唯一の振る舞いの違い）:
// 本家はロビーのアーケード筐体に AGO 本体のオンラインゲーム26タイトルを
// 埋め込んでいるが、それらは WORLD BOX の中身ではないため移行対象に含めない。
// レジストリを空にすると筐体パネル側は未登録として「準備中」表示になる
// （arcadeClientFor が null を返す経路は本家にもある正規の分岐）。
// 筐体そのもの・配置・ステーションは本家と同一。
import type { ComponentType } from "react";

/** ゲーム ID → ゲーム本体の部品。移行版では空。 */
export const ARCADE_CLIENTS: Record<string, ComponentType> = {};

/** 筐体のゲーム本体。未登録なら null（パネル側で準備中表示にする）。 */
export function arcadeClientFor(gameId: string): ComponentType | null {
  return ARCADE_CLIENTS[gameId] ?? null;
}
