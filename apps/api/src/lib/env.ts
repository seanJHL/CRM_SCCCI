import type { Bindings } from "@/types";

/**
 * Normalised environment configuration derived from the Hono context.
 */
export interface EnvConfig {
  environment: string;
  corsOrigin: string;
  databaseUrl: string;
  authSecret: string;
  vapidPublicKey: string;
  vapidPrivateKey: string;
  vapidSubject: string;
  googleClientId: string;
  googleClientSecret: string;
  googleRedirectUri: string;
  encryptionKey: string;
  sessionSecret: string;
  openRouterApiKey: string;
  isProduction: boolean;
  isPreview: boolean;
  isSecureDeployment: boolean;
}

/**
 * Build a normalised env config from Cloudflare Worker bindings.
 */
export function getEnv(bindings?: Partial<Bindings>): EnvConfig {
  const environment = bindings?.ENVIRONMENT ?? "development";
  return {
    environment,
    corsOrigin: bindings?.CORS_ORIGIN ?? "*",
    databaseUrl: bindings?.DATABASE_URL ?? "",
    authSecret: bindings?.AUTH_SECRET ?? "",
    vapidPublicKey: bindings?.VAPID_PUBLIC_KEY ?? "",
    vapidPrivateKey: bindings?.VAPID_PRIVATE_KEY ?? "",
    vapidSubject: bindings?.VAPID_SUBJECT ?? "mailto:push@ember.app",
    googleClientId: bindings?.GOOGLE_CLIENT_ID ?? "",
    googleClientSecret: bindings?.GOOGLE_CLIENT_SECRET ?? "",
    googleRedirectUri: bindings?.GOOGLE_REDIRECT_URI ?? "http://localhost:8788/api/auth/google/callback",
    encryptionKey: bindings?.ENCRYPTION_KEY ?? "",
    sessionSecret: bindings?.SESSION_SECRET ?? bindings?.AUTH_SECRET ?? "",
    openRouterApiKey: bindings?.OPENROUTER_API_KEY ?? "",
    isProduction: environment === "production",
    isPreview: environment === "preview",
    isSecureDeployment: environment !== "development",
  };
}

/**
 * Parse the CORS_ORIGIN string into an array of allowed origins.
 * Supports comma-separated values and the wildcard "*".
 */
export function parseCorsOrigins(origin: string): string[] {
  if (origin === "*") return ["*"];
  return origin
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}
