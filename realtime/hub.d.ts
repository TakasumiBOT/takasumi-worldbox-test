export interface RealtimeAuth {
  pid: string;
  name: string;
  ok: string | null;
  tab?: string;
  tabAt?: number;
}

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

export interface RealtimeKvAdapter {
  kvList(namespace: string): Promise<Map<string, unknown>>;
  kvGet(namespace: string, key: string): Promise<unknown | null>;
  kvSet(namespace: string, key: string, value: unknown): Promise<void>;
  kvDelete?(namespace: string, key: string): Promise<void>;
}

export interface RealtimeHubOptions {
  secret?: string;
  kvCfg?: RealtimeKvAdapter | unknown;
}

export declare function createHub(options?: RealtimeHubOptions): RealtimeHub;
export declare function getHub(options?: RealtimeHubOptions): RealtimeHub;
