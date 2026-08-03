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
  /** Google OAuth 2.0 client ID */
  GOOGLE_CLIENT_ID: string;
  /** Google OAuth 2.0 client secret (secret) */
  GOOGLE_CLIENT_SECRET: string;
  /** Google OAuth 2.0 redirect URI (e.g. http://localhost:8788/api/auth/google/callback) */
  GOOGLE_REDIRECT_URI: string;
  /** 32-byte base64 key for AES-GCM token encryption (secret) */
  ENCRYPTION_KEY: string;
  /** Secret for hashing session tokens (secret) */
  SESSION_SECRET: string;
  /** OpenRouter API key used only for user-requested reply suggestions (secret) */
  OPENROUTER_API_KEY?: string;
}

/**
 * Authenticated user attached to the Hono context by the session middleware.
 * Subset of the users table — no sensitive fields.
 */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  timezone: string;
  workingHoursStart: string;
  workingHoursEnd: string;
}

/**
 * Values attached to the Hono context by middleware.
 */
export interface Variables {
  requestId: string;
  /** Authenticated user (set by authMiddleware) */
  user: AuthUser;
  /** User ID shortcut (set by authMiddleware) */
  userId: string;
}

export type AppBindings = {
  Bindings: Bindings;
  Variables: Variables;
};
