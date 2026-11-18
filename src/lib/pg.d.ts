declare module "pg" {
  export class Pool {
    constructor(config?: { connectionString?: string });
    query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
    connect(): Promise<{
      query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
      release(): void;
    }>;
    end(): Promise<void>;
  }
}
