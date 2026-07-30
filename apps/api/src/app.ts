import { Hono } from "hono";
import { cors } from "hono/cors";
import type { AppBindings } from "@/types";
import { getEnv, parseCorsOrigins } from "@/lib/env";
import { errorHandler, requestIdMiddleware } from "@/middleware/error-handler";
import { requestLogger } from "@/middleware/logger";
import routes from "@/routes";

/**
 * Hono application factory.
 *
 * Returns a configured Hono instance with:
 *  - Request ID middleware
 *  - Structured request logging
 *  - Secure CORS based on the CORS_ORIGIN env var
 *  - Global error handler
 *  - API routes under /api
 */
export function createApp() {
  const app = new Hono<AppBindings>();

  // --- Middleware (order matters) ---
  app.use("*", requestIdMiddleware);
  app.use("*", requestLogger);

  // CORS — configured dynamically from the CORS_ORIGIN env var
  app.use("*", async (c, next) => {
    const env = getEnv(c.env);
    const origins = parseCorsOrigins(env.corsOrigin);
    const corsMiddleware = cors({
      origin: origins.includes("*") ? "*" : origins,
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization", "X-Request-ID"],
      exposeHeaders: ["X-Request-ID"],
      credentials: !origins.includes("*"),
      maxAge: 86400,
    });
    return corsMiddleware(c, next);
  });

  // --- Routes ---
  app.route("/api", routes);

  // Root health check (convenient for uptime monitors)
  app.get("/", (c) =>
    c.json({ status: "ok", service: "crm-api", docs: "/api/health" }),
  );

  // --- Error handling (must be last) ---
  app.onError(errorHandler());

  // 404 fallback
  app.notFound((c) =>
    c.json(
      {
        success: false,
        error: { code: "NOT_FOUND", message: `Route ${c.req.method} ${c.req.path} not found` },
      },
      404,
    ),
  );

  return app;
}
