import type { MiddlewareHandler } from "hono";
import type { AppBindings } from "@/types";
import { ApiError } from "@/lib/utils";
import { getEnv, parseCorsOrigins } from "@/lib/env";
import { createDatabase } from "@/db";
import { readSessionCookie, getAuthUser } from "@/lib/session";

/**
 * Session-based auth middleware for protected CRM routes.
 *
 * Reads the session cookie, validates it against the auth_sessions table,
 * and attaches the authenticated user to the Hono context.
 *
 * Apply only to CRM-specific route prefixes:
 *   app.use("/api/gmail/*", authMiddleware)
 *   app.use("/api/calendar-crm/*", authMiddleware)
 *   app.use("/api/privacy/*", authMiddleware)
 */
export const authMiddleware: MiddlewareHandler<AppBindings> = async (c, next) => {
  const token = readSessionCookie(c);
  if (!token) {
    throw ApiError.unauthorized("Not authenticated — please sign in");
  }

  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const user = await getAuthUser(db, token, env.sessionSecret);
  if (!user) {
    throw ApiError.unauthorized("Session expired — please sign in again");
  }

  c.set("user", user);
  c.set("userId", user.id);

  // Credentialed cross-origin cookies require an explicit CSRF check for
  // mutations. Browsers include Origin on form/fetch requests, including
  // cross-site attacks; trusted non-browser clients may omit it.
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
    const origin = c.req.header("origin");
    const allowedOrigins = parseCorsOrigins(env.corsOrigin);
    if (origin && !allowedOrigins.includes("*") && !allowedOrigins.includes(origin)) {
      throw ApiError.forbidden("Request origin is not allowed");
    }
  }

  await next();
};
