"use client";
import { DiscordSDK } from "@discord/embedded-app-sdk";
import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  roomFromShareCustomId,
  shareCustomIdForRoom,
  type DiscordIdentity,
} from "@/lib/discord-activity";
import { authenticateDiscordIdentity } from "@/lib/discord-activity-client";

export type GamesNav = {
  embedded: boolean;
  prefix: string;
  identity: DiscordIdentity | null;
  retryIdentity: (() => void) | null;
  shareRoomInvite: ((gameId: string, code: string) => Promise<boolean>) | null;
};

const GamesNavContext = createContext<GamesNav>({
  embedded: false,
  prefix: "",
  identity: null,
  retryIdentity: null,
  shareRoomInvite: null,
});

export function useGamesNav(): GamesNav {
  return useContext(GamesNavContext);
}

const STORAGE_KEY = "agobot:activity-embedded";
const SDK_READY_TIMEOUT_MS = 4000;

function hasActivityParams(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.has("frame_id") && params.has("instance_id");
}

function readStoredEmbedded(): boolean {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function storeEmbedded() {
  try {
    sessionStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // 保存できなくても表示は続けられる
  }
}

const ROUTED_CUSTOM_ID_KEY = "agobot:invite-routed-custom-id";

export default function GamesShell({
  clientId,
  children,
}: {
  clientId: string;
  children: ReactNode;
}) {
  const [embedded, setEmbedded] = useState(false);
  const [prefix, setPrefix] = useState("");
  const [identity, setIdentity] = useState<DiscordIdentity | null>(null);
  const sdkRef = useRef<DiscordSDK | null>(null);
  const sdkStartedRef = useRef(false);
  const authStartedRef = useRef(false);

  const retryIdentity = useCallback(() => {
    const sdk = sdkRef.current;
    if (!sdk || !clientId) return;
    void authenticateDiscordIdentity(sdk, clientId).then((result) => {
      if (result) setIdentity(result);
    });
  }, [clientId]);

  const shareRoomInvite = useCallback(async (gameId: string, code: string): Promise<boolean> => {
    const sdk = sdkRef.current;
    const customId = shareCustomIdForRoom(gameId, code);
    if (!sdk || !customId) return false;
    try {
      const result = await sdk.commands.shareLink({
        message: `ゲームで対戦しよう（ルームコード: ${code}）`,
        custom_id: customId,
      });
      return Boolean(result.success);
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const proxyPrefix =
      window.location.pathname.startsWith("/.proxy/") || window.location.pathname === "/.proxy"
        ? "/.proxy"
        : "";
    if (proxyPrefix) setPrefix(proxyPrefix);
    const fromDiscord = hasActivityParams();
    const stored = readStoredEmbedded();
    let inIframe = false;
    try {
      inIframe = window.self !== window.top;
    } catch {
      inIframe = true;
    }
    if (fromDiscord || stored) {
      setEmbedded(true);
      storeEmbedded();
    }
    if (fromDiscord || stored) {
      const target = roomFromShareCustomId(
        new URLSearchParams(window.location.search).get("custom_id"),
      );
      const barePath = proxyPrefix
        ? window.location.pathname.slice(proxyPrefix.length) || "/"
        : window.location.pathname;
      if (target && (barePath === "/games" || barePath === "/")) {
        let alreadyRouted = false;
        try {
          alreadyRouted = sessionStorage.getItem(ROUTED_CUSTOM_ID_KEY) === target.code;
          if (!alreadyRouted) sessionStorage.setItem(ROUTED_CUSTOM_ID_KEY, target.code);
        } catch {
          // 保存できなくても遷移自体は行う
        }
        if (!alreadyRouted) {
          window.location.assign(`${proxyPrefix}/games/${target.gameId}?room=${target.code}`);
          return;
        }
      }
    }
    if (!clientId || sdkStartedRef.current) return;
    if (!fromDiscord && !stored && !inIframe) return;
    sdkStartedRef.current = true;
    const sdk = new DiscordSDK(clientId, { disableConsoleLogOverride: true });
    sdkRef.current = sdk;
    const timeout = new Promise<never>((_, reject) => {
      window.setTimeout(() => reject(new Error("Discord SDK ready timeout")), SDK_READY_TIMEOUT_MS);
    });
    Promise.race([sdk.ready(), timeout])
      .then(() => {
        if (cancelled) return;
        setEmbedded(true);
        storeEmbedded();
        if (!authStartedRef.current) {
          authStartedRef.current = true;
          void authenticateDiscordIdentity(sdk, clientId).then((result) => {
            if (!cancelled && result) setIdentity(result);
          });
        }
      })
      .catch(() => {
        if (cancelled) return;
        if (!fromDiscord && !stored) setEmbedded(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  return (
    <GamesNavContext.Provider
      value={{
        embedded,
        prefix,
        identity,
        retryIdentity: embedded ? retryIdentity : null,
        shareRoomInvite: embedded ? shareRoomInvite : null,
      }}
    >
      <div className="games-shell" {...(embedded ? { "data-activity-root": "" } : {})}>
        {embedded && (
          <nav className="games-embedded-bar" aria-label="ゲームメニュー">
            <span className="games-embedded-brand">ゲーム</span>
            <span className="games-embedded-links">
              <Link href={`${prefix}/games`}>ゲーム一覧</Link>
            </span>
            {identity && (
              <span className="games-embedded-identity">
                <img src={identity.avatarUrl} alt="" width={24} height={24} />
                {identity.name}
              </span>
            )}
          </nav>
        )}
        {children}
      </div>
    </GamesNavContext.Provider>
  );
}
