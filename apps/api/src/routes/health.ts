import { Hono } from "hono";
import type { AppBindings } from "@/types";
import { ok } from "@/lib/utils";
import { getEnv } from "@/lib/env";

const health = new Hono<AppBindings>();

health.get("/", (c) => {
  const env = getEnv(c.env, { ENVIRONMENT: c.var.ENVIRONMENT, CORS_ORIGIN: c.var.CORS_ORIGIN });
  return c.json(
    ok({
      status: "healthy",
      timestamp: new Date().toISOString(),
      environment: env.environment,
    }),
  );
});

export default health;
