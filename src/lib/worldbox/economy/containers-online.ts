import { isBotApiConfigured, kvDelete, kvGet, kvSet } from "../../bot-api";
import { parseContainerState, serializeContainerState, type ContainerState } from "./containers";
import { tileKey } from "../world/tiles";

export const WORLDBOX_CONTAINERS_NAMESPACE = "worldbox_containers";

export function isContainersEnabled(): boolean {
  return isBotApiConfigured();
}

export function containerKey(space: string, x: number, y: number): string {
  return `${space}|${tileKey(x, y)}`;
}

export async function loadContainer(
  space: string,
  x: number,
  y: number,
  itemId: string,
): Promise<ContainerState | null> {
  if (!isBotApiConfigured()) return null;
  try {
    const stored = await kvGet(WORLDBOX_CONTAINERS_NAMESPACE, containerKey(space, x, y));
    if (stored !== null) return parseContainerState(stored, itemId);
    if (space === "world") {
      return parseContainerState(await kvGet(WORLDBOX_CONTAINERS_NAMESPACE, tileKey(x, y)), itemId);
    }
    return null;
  } catch {
    return null;
  }
}

export async function storeContainer(
  space: string,
  x: number,
  y: number,
  state: ContainerState | null,
): Promise<boolean> {
  if (!isBotApiConfigured()) return false;
  try {
    if (state === null) {
      await kvDelete(WORLDBOX_CONTAINERS_NAMESPACE, containerKey(space, x, y));
      if (space === "world") await kvDelete(WORLDBOX_CONTAINERS_NAMESPACE, tileKey(x, y));
    } else {
      await kvSet(
        WORLDBOX_CONTAINERS_NAMESPACE,
        containerKey(space, x, y),
        serializeContainerState(state),
      );
    }
    return true;
  } catch {
    return false;
  }
}
