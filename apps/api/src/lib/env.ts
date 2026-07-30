import type { Bindings } from "@/types";

/**
 * Normalised environment configuration derived from the Hono context.
 */
export interface EnvConfig {
  environment: string;
  corsOrigin: string;
  databaseUrl: string;
  authSecret: string;
  isProduction: boolean;
  isPreview: boolean;
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
    isProduction: environment === "production",
    isPreview: environment === "preview",
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
