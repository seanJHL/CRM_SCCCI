import type { MiddlewareHandler } from "hono";
import type { AppBindings } from "@/types";
import { ApiError } from "@/lib/utils";
import { getEnv } from "@/lib/env";

/**
 * Placeholder auth middleware — validates a Bearer token against AUTH_SECRET.
 *
 * In a real CRM this would be replaced with a JWT verification flow or
 * a session-cookie check. For now it demonstrates the pattern.
 *
 * Usage:
 *   app.use("/api/*", authMiddleware)
 */
export const authMiddleware: MiddlewareHandler<AppBindings> = async (c, next) => {
  const env = getEnv(c.env);

  // Skip auth for health checks
  if (c.req.path === "/api/health" || c.req.path === "/") {
    return next();
  }

  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw ApiError.unauthorized("Missing or invalid Authorization header");
  }

  const token = authHeader.slice(7);
  if (!env.authSecret || token !== env.authSecret) {
    throw ApiError.unauthorized("Invalid API key");
  }

  await next();
};
