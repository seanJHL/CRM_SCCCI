import type { Bindings, Variables } from "@/types";

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
 * Build a normalised env config from Cloudflare Worker bindings + variables.
 */
export function getEnv(
  bindings: Bindings,
  variables: Variables,
): EnvConfig {
  const environment = variables.ENVIRONMENT ?? "development";
  return {
    environment,
    corsOrigin: variables.CORS_ORIGIN ?? "*",
    databaseUrl: bindings.DATABASE_URL ?? "",
    authSecret: bindings.AUTH_SECRET ?? "",
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
