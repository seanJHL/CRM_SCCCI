import type { MiddlewareHandler } from "hono";
import type { AppBindings } from "@/types";
import { getEnv } from "@/lib/env";

/**
 * Structured request logger.
 * Logs method, path, status, duration, and request ID.
 * In production, Cloudflare Workers Logpush / tail workers will pick these up.
 */
export const requestLogger: MiddlewareHandler<AppBindings> = async (c, next) => {
  const start = Date.now();
  const env = getEnv(c.env, { ENVIRONMENT: c.var.ENVIRONMENT, CORS_ORIGIN: c.var.CORS_ORIGIN });
  const requestId = c.req.header("x-request-id") ?? "-";

  await next();

  const duration = Date.now() - start;
  const status = c.res.status;
  const method = c.req.method;
  const path = c.req.path;

  const logEntry = {
    level: status >= 500 ? "error" : status >= 400 ? "warn" : "info",
    type: "request",
    requestId,
    method,
    path,
    status,
    duration,
    environment: env.environment,
  };

  if (logEntry.level === "error") {
    console.error(JSON.stringify(logEntry));
  } else if (logEntry.level === "warn") {
    console.warn(JSON.stringify(logEntry));
  } else {
    console.log(JSON.stringify(logEntry));
  }
};
