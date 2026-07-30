import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * Standard API error structure for consistent error responses.
 */
export class ApiError extends Error {
  readonly statusCode: ContentfulStatusCode;
  readonly code: string;
  readonly details?: unknown;

  constructor(
    statusCode: ContentfulStatusCode,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  static badRequest(message: string, details?: unknown) {
    return new ApiError(400, "BAD_REQUEST", message, details);
  }

  static notFound(message: string) {
    return new ApiError(404, "NOT_FOUND", message);
  }

  static unauthorized(message = "Unauthorized") {
    return new ApiError(401, "UNAUTHORIZED", message);
  }

  static forbidden(message = "Forbidden") {
    return new ApiError(403, "FORBIDDEN", message);
  }

  static internal(message = "Internal server error") {
    return new ApiError(500, "INTERNAL_ERROR", message);
  }
}

/**
 * Standard JSON success response shape.
 */
export function ok<T>(data: T, message = "OK") {
  return { success: true as const, data, message };
}

/**
 * Generate a ULID-like unique ID (timestamp + random).
 * Suitable for use in Workers where crypto.randomUUID is available.
 */
export function generateId(): string {
  return crypto.randomUUID();
}
