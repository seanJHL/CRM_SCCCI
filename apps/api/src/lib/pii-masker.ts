/**
 * PII masking — redact email addresses, phone numbers, and other
 * sensitive patterns before logging or storing in audit logs.
 */

const EMAIL_RE =
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE =
  /(\+?\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}/g;
const TOKEN_RE = /ya29\.[A-Za-z0-9_-]+/g; // Google access token pattern
const KEY_RE = /AIza[A-Za-z0-9_-]{35}/g; // Google API key pattern

/**
 * Mask PII in a text string. Replaces:
 * - Email addresses → [EMAIL]
 * - Phone numbers → [PHONE]
 * - Google access tokens → [TOKEN]
 * - Google API keys → [KEY]
 */
export function maskPii(text: string): string {
  return text
    .replace(EMAIL_RE, "[EMAIL]")
    .replace(TOKEN_RE, "[TOKEN]")
    .replace(KEY_RE, "[KEY]")
    .replace(PHONE_RE, "[PHONE]");
}

/**
 * Mask PII in an object's string values. Returns a new object.
 */
export function maskPiiInObject(obj: unknown): unknown {
  if (typeof obj === "string") return maskPii(obj);
  if (obj == null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(maskPiiInObject);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    result[key] = maskPiiInObject(value);
  }
  return result;
}
