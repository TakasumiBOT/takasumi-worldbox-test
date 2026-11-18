export type WbLayoutMode = "wide" | "portrait" | "landscape";

export const WB_PORTRAIT_MAX_WIDTH = 759;
export const WB_LANDSCAPE_MAX_HEIGHT = 499;

export function wbLayoutMode(width: number, height: number): WbLayoutMode {
  if (width <= WB_PORTRAIT_MAX_WIDTH && height >= width) return "portrait";
  if (width > height && height <= WB_LANDSCAPE_MAX_HEIGHT) return "landscape";
  return "wide";
}

export interface WbHudMetrics {
  minimapPx: number;
  hotbarSlotCss: string;
  buttonMinHeight: number;
  chatOnRight: boolean;
  chatWidthCss: string;
  chatBottomPx: number;
  chatMessagesPx: number;
  playerCardBottomPx: number;
  partyCardBottomPx: number;
}

export const WB_CHAT_LEFT_CLEARANCE_PX = 156;

export function wbHudMetrics(mode: WbLayoutMode): WbHudMetrics {
  switch (mode) {
    case "portrait":
      return {
        minimapPx: 88,
        hotbarSlotCss: "clamp(38px, 12vw, 44px)",
        buttonMinHeight: 44,
        chatOnRight: true,
        chatWidthCss: `min(260px, calc(100% - ${WB_CHAT_LEFT_CLEARANCE_PX}px))`,
        chatBottomPx: 70,
        chatMessagesPx: 118,
        playerCardBottomPx: 240,
        partyCardBottomPx: 70,
      };
    case "landscape":
      return {
        minimapPx: 88,
        hotbarSlotCss: "44px",
        buttonMinHeight: 44,
        chatOnRight: true,
        chatWidthCss: "260px",
        chatBottomPx: 70,
        chatMessagesPx: 84,
        playerCardBottomPx: 204,
        partyCardBottomPx: 70,
      };
    default:
      return {
        minimapPx: 112,
        hotbarSlotCss: "clamp(30px, 10.5vw, 42px)",
        buttonMinHeight: 40,
        chatOnRight: false,
        chatWidthCss: "min(300px, calc(100% - 130px))",
        chatBottomPx: 10,
        chatMessagesPx: 118,
        playerCardBottomPx: 108,
        partyCardBottomPx: 120,
      };
  }
}
