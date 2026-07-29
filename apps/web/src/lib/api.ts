/**
 * API client for the Hono backend.
 * Reads the backend URL from the VITE_API_URL environment variable.
 */

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:8787";

/** Standard error shape returned by the backend. */
export interface ApiErrorShape {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId?: string;
}

/** Standard success response. */
export interface ApiSuccess<T> {
  success: true;
  data: T;
  message: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiErrorShape;

async function request<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const url = `${API_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
    },
  });

  const body: ApiResponse<T> = await res.json();

  if (!body.success) {
    throw new Error(body.error.message);
  }

  return body.data;
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: "GET" }),
  post: <T>(path: string, data: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(data) }),
  patch: <T>(path: string, data: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(data) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
