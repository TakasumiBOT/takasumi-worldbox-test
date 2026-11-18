"use client";
import type { ComponentType } from "react";

export const ARCADE_CLIENTS: Record<string, ComponentType> = {};

export function arcadeClientFor(gameId: string): ComponentType | null {
  return ARCADE_CLIENTS[gameId] ?? null;
}
