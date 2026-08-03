const configuredApiUrl = (
  import.meta.env.VITE_API_URL as string | undefined
)?.trim();

/**
 * The backend origin used by both the normal API client and Web Push.
 * An empty value deliberately means same-origin, which is useful when the
 * frontend and API are routed behind one host.
 */
export const API_URL = (configuredApiUrl ?? "").replace(/\/$/, "");

export function getApiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_URL}${normalizedPath}`;
}
