type Fetcher = {
  fetch(request: Request): Promise<Response>;
};

type D1Result<T = unknown> = {
  results?: T[];
  success: boolean;
  error?: string;
  meta: Record<string, unknown>;
};

type D1PreparedStatement = {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  run<T = unknown>(): Promise<D1Result<T>>;
  all<T = unknown>(): Promise<D1Result<T>>;
};

type D1Database = {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
};

declare module "cloudflare:workers" {
  export const env: {
    DB?: D1Database;
  };
}
