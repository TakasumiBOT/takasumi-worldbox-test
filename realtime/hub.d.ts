// hub.js（CommonJS）の型宣言。実装は realtime/hub.js。
export interface RealtimeAuth {
  pid: string;
  name: string;
  ok: string | null;
  tab?: string;
  tabAt?: number;
}

/** ws パッケージの WebSocket が満たす最小の形（ハブが使う分だけ）。 */
export interface RelaySocket {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  ping(): void;
  terminate(): void;
  on(event: "message", listener: (data: unknown) => void): void;
  on(event: "close" | "error", listener: () => void): void;
  on(event: "pong", listener: () => void): void;
}

export interface RealtimeHub {
  verifyAuth(searchParams: URLSearchParams): RealtimeAuth | null;
  handleConnection(ws: RelaySocket, auth: RealtimeAuth): void;
  clientCount(): number;
}

export declare function createHub(options?: { secret?: string; kvCfg?: unknown }): RealtimeHub;
export declare function getHub(): RealtimeHub;
