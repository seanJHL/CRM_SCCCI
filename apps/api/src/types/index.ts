/**
 * Cloudflare Worker bindings (secrets set via `wrangler secret put` or dashboard).
 */
export interface Bindings {
  /** Neon database connection string (secret) */
  DATABASE_URL: string;
  /** JWT or API key secret for auth (secret) */
  AUTH_SECRET: string;
}

/**
 * Non-secret variables defined in wrangler.jsonc under `vars`.
 */
export interface Variables {
  /** Current deployment environment */
  ENVIRONMENT: string;
  /** Allowed CORS origin(s) */
  CORS_ORIGIN: string;
}

/**
 * Hono context bindings — merges Worker bindings and route variables.
 */
export type AppBindings = {
  Bindings: Bindings;
  Variables: Variables;
};
