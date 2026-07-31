/**
 * Cloudflare Worker bindings (secrets set via `wrangler secret put` or dashboard).
 */
export interface Bindings {
  /** Neon database connection string (secret) */
  DATABASE_URL: string;
  /** JWT or API key secret for auth (secret) */
  AUTH_SECRET: string;
  /** Current deployment environment */
  ENVIRONMENT: string;
  /** Allowed CORS origin(s) */
  CORS_ORIGIN: string;
  /** VAPID public key for Web Push (safe to expose to clients) */
  VAPID_PUBLIC_KEY: string;
  /** VAPID private key for signing Web Push messages (secret) */
  VAPID_PRIVATE_KEY: string;
  /** Contact mailto: for VAPID subject (e.g. mailto:you@example.com) */
  VAPID_SUBJECT?: string;
}

/**
 * Values attached to the Hono context by middleware.
 */
export interface Variables {
  requestId: string;
}

export type AppBindings = {
  Bindings: Bindings;
  Variables: Variables;
};
