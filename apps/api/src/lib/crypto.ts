/**
 * AES-GCM encryption and SHA-256 hashing utilities built on the Web Crypto API.
 * Used for encrypting OAuth tokens at rest and hashing session tokens.
 */

const ALGO = "AES-GCM";
const IV_LENGTH = 12;

/**
 * Import a base64-encoded 32-byte key as a CryptoKey for AES-GCM.
 */
async function importKey(keyB64: string): Promise<CryptoKey> {
  const raw = Buffer.from(keyB64, "base64");
  if (raw.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY must decode to 32 bytes, got ${raw.length}. Generate with: openssl rand -base64 32`,
    );
  }
  return crypto.subtle.importKey("raw", raw, { name: ALGO }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/**
 * Encrypt a plaintext string using AES-GCM.
 * Returns a base64 string in the format "iv:ciphertext".
 */
export async function encryptToken(
  plaintext: string,
  keyB64: string,
): Promise<string> {
  const key = await importKey(keyB64);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoded = new TextEncoder().encode(plaintext);

  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGO, iv },
    key,
    encoded,
  );

  const ivB64 = Buffer.from(iv).toString("base64");
  const ctB64 = Buffer.from(new Uint8Array(ciphertext)).toString("base64");
  return `${ivB64}:${ctB64}`;
}

/**
 * Decrypt a string in "iv:ciphertext" base64 format back to plaintext.
 */
export async function decryptToken(
  encrypted: string,
  keyB64: string,
): Promise<string> {
  const [ivB64, ctB64] = encrypted.split(":");
  if (!ivB64 || !ctB64) {
    throw new Error("Invalid encrypted token format");
  }

  const key = await importKey(keyB64);
  const iv = Buffer.from(ivB64, "base64");
  const ciphertext = Buffer.from(ctB64, "base64");

  const decrypted = await crypto.subtle.decrypt(
    { name: ALGO, iv },
    key,
    ciphertext,
  );

  return new TextDecoder().decode(decrypted);
}

/**
 * Hash a session token using SHA-256 and return a hex string.
 * Only the hash is stored in the database — the raw token lives in the cookie.
 */
export async function hashToken(token: string, secret: string): Promise<string> {
  if (!secret) {
    throw new Error("SESSION_SECRET is required");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(token),
  );
  return Buffer.from(new Uint8Array(digest)).toString("hex");
}

/**
 * Generate a cryptographically random session token.
 */
export function generateSessionToken(): string {
  return randomUrlSafeToken(32);
}

/** Generate a URL-safe token from cryptographically secure random bytes. */
export function randomUrlSafeToken(byteLength = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return Buffer.from(bytes).toString("base64url");
}

/** Build the S256 PKCE challenge used during the OAuth authorization flow. */
export async function createPkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return Buffer.from(new Uint8Array(digest)).toString("base64url");
}

/** Compare two secrets without returning early on the first mismatch. */
export async function secureEqual(left: string, right: string): Promise<boolean> {
  const [leftHash, rightHash] = await Promise.all(
    [left, right].map(async (value) => {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(value),
      );
      return new Uint8Array(digest);
    }),
  );

  let difference = leftHash.length ^ rightHash.length;
  for (let index = 0; index < leftHash.length; index += 1) {
    difference |= leftHash[index]! ^ rightHash[index]!;
  }
  return difference === 0;
}
