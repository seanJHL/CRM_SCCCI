import type { Context, MiddlewareHandler } from "hono";
import type { AppBindings } from "@/types";
import { ApiError } from "@/lib/utils";
import { getEnv } from "@/lib/env";

/**
 * Global error handler. Converts thrown errors into a consistent JSON shape.
 * - ApiError → uses the provided statusCode / code / details
 * - ZodError → 400 with field-level details
 * - everything else → 500 (message hidden in production)
 */
export function errorHandler() {
  return (err: Error, c: Context<AppBindings>) => {
    const env = getEnv(c.env);
    const requestId = c.get("requestId") ?? "unknown";

    // Zod validation errors
    if (err.name === "ZodError") {
      const details =
        "errors" in err && Array.isArray((err as { errors: unknown }).errors)
          ? (err as { errors: unknown }).errors
          : undefined;
      console.error(
        JSON.stringify({
          level: "error",
          type: "validation_error",
          requestId,
          details,
        }),
      );
      return c.json(
        {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Request validation failed",
            details,
          },
          requestId,
        },
        400,
      );
    }

    // Our own typed errors
    if (err instanceof ApiError) {
      if (err.statusCode >= 500) {
        console.error(
          JSON.stringify({
            level: "error",
            type: "api_error",
            requestId,
            code: err.code,
            message: err.message,
            stack: err.stack,
          }),
        );
      }
      return c.json(
        {
          success: false,
          error: {
            code: err.code,
            message: err.message,
            details: err.details,
          },
          requestId,
        },
        err.statusCode,
      );
    }

    // Unknown errors — hide details in non-development environments
    console.error(
      JSON.stringify({
        level: "error",
        type: "unhandled_error",
        requestId,
        name: err.name,
        message: err.message,
        stack: err.stack,
      }),
    );

    const message = env.environment === "development" ? err.message : "Internal server error";
    return c.json(
      {
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message,
        },
        requestId,
      },
      500,
    );
  };
}

/**
 * Attaches a unique request ID to the context and the response header.
 * Useful for tracing logs across the stack.
 */
export const requestIdMiddleware: MiddlewareHandler<AppBindings> = async (c, next) => {
  const requestId =
    c.req.header("x-request-id") || crypto.randomUUID();
  c.set("requestId", requestId);
  c.header("x-request-id", requestId);
  await next();
};
