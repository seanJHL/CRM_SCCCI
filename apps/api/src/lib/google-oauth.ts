/**
 * Google OAuth 2.0 helpers — authorization URL, code exchange,
 * token refresh, id_token verification, and revocation.
 */

import { eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import type * as schema from "@/db/schema";
import { googleAccounts } from "@/db/schema";
import { encryptToken, decryptToken } from "@/lib/crypto";
import type { EnvConfig } from "@/lib/env";
import { ApiError } from "@/lib/utils";
import type { AuthUser } from "@/types";

type Database = NeonHttpDatabase<typeof schema>;

/** Minimum, feature-specific OAuth scopes for CRM functionality. */
export const GOOGLE_SCOPE = {
  GMAIL_READ: "https://www.googleapis.com/auth/gmail.readonly",
  GMAIL_SEND: "https://www.googleapis.com/auth/gmail.send",
  CALENDAR_EVENTS: "https://www.googleapis.com/auth/calendar.events",
  CALENDAR_AVAILABILITY:
    "https://www.googleapis.com/auth/calendar.events.freebusy",
} as const;

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  GOOGLE_SCOPE.GMAIL_READ,
  GOOGLE_SCOPE.GMAIL_SEND,
  GOOGLE_SCOPE.CALENDAR_EVENTS,
  GOOGLE_SCOPE.CALENDAR_AVAILABILITY,
].join(" ");

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";

/**
 * Build the Google OAuth consent URL.
 * Uses access_type=offline for refresh tokens. Existing refresh tokens are
 * retained when Google omits a new one on later sign-ins.
 */
export function getAuthUrl(
  env: EnvConfig,
  options: { state: string; nonce: string; codeChallenge: string },
): string {
  const search = new URLSearchParams({
    client_id: env.googleClientId,
    redirect_uri: env.googleRedirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES,
    access_type: "offline",
    prompt: "select_account",
    state: options.state,
    nonce: options.nonce,
    code_challenge: options.codeChallenge,
    code_challenge_method: "S256",
    include_granted_scopes: "true",
  });
  return `${AUTH_URL}?${search.toString()}`;
}

/** Result from exchanging an authorization code. */
export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

/**
 * Exchange an authorization code for tokens.
 */
export async function exchangeCode(
  env: EnvConfig,
  code: string,
  codeVerifier: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    code,
    client_id: env.googleClientId,
    client_secret: env.googleClientSecret,
    redirect_uri: env.googleRedirectUri,
    grant_type: "authorization_code",
    code_verifier: codeVerifier,
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new ApiError(
      401,
      "GOOGLE_AUTH_FAILED",
      `Google authorization failed: ${(err as { error_description?: string }).error_description ?? res.statusText}`,
    );
  }

  return res.json();
}

/**
 * Refresh an expired access token using a refresh token.
 */
export async function refreshAccessToken(
  env: EnvConfig,
  refreshToken: string,
): Promise<{ access_token: string; expires_in: number }> {
  const body = new URLSearchParams({
    client_id: env.googleClientId,
    client_secret: env.googleClientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as {
      error?: string;
      error_description?: string;
    };
    if (err.error === "invalid_grant") {
      throw new ApiError(
        401,
        "GOOGLE_REAUTH_REQUIRED",
        "Google access has expired or was revoked. Please reconnect your account.",
      );
    }
    throw new ApiError(
      502,
      "GOOGLE_TOKEN_REFRESH_FAILED",
      `Google token refresh failed: ${err.error_description ?? res.statusText}`,
    );
  }

  return res.json();
}

/** Decoded id_token payload. */
export interface IdTokenPayload {
  sub: string;
  email: string;
  name: string;
  picture?: string;
  email_verified?: boolean;
}

/**
 * Cryptographically verify a Google id_token using Google's published JWKs,
 * then validate issuer, audience, expiry, nonce, and verified email claims.
 */
export async function verifyIdToken(
  env: EnvConfig,
  idToken: string,
  expectedNonce: string,
): Promise<IdTokenPayload> {
  const parts = idToken.split(".");
  if (parts.length !== 3) {
    throw ApiError.badRequest("Invalid id_token format");
  }

  const header = decodeJwtPart(parts[0]) as {
    alg?: string;
    kid?: string;
  };
  const payload = decodeJwtPart(parts[1]) as Partial<IdTokenPayload> & {
    iss: string;
    aud: string | string[];
    exp: number;
    iat?: number;
    nonce?: string;
  };

  if (header.alg !== "RS256" || !header.kid) {
    throw ApiError.unauthorized("Unsupported Google id_token signature");
  }

  const key = await getGoogleSigningKey(header.kid);
  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    key,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signature = Uint8Array.from(Buffer.from(parts[2], "base64url"));
  const validSignature = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    signature,
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!validSignature) {
    throw ApiError.unauthorized("Invalid Google id_token signature");
  }

  // Verify issuer
  if (payload.iss !== "https://accounts.google.com" && payload.iss !== "accounts.google.com") {
    throw ApiError.unauthorized("Invalid id_token issuer");
  }

  // Verify audience
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(env.googleClientId)) {
    throw ApiError.unauthorized("Invalid id_token audience");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < nowSeconds - 30) {
    throw ApiError.unauthorized("id_token has expired");
  }
  if (payload.iat && payload.iat > nowSeconds + 60) {
    throw ApiError.unauthorized("id_token was issued in the future");
  }
  if (!payload.nonce || payload.nonce !== expectedNonce) {
    throw ApiError.unauthorized("Invalid id_token nonce");
  }
  if (!payload.sub || !payload.email || payload.email_verified !== true) {
    throw ApiError.unauthorized("Google account email could not be verified");
  }

  return {
    sub: payload.sub,
    email: payload.email,
    name: payload.name || payload.email.split("@")[0] || "Google user",
    picture: payload.picture,
    email_verified: payload.email_verified,
  };
}

function decodeJwtPart(part: string): unknown {
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf-8"));
  } catch {
    throw ApiError.badRequest("Invalid id_token encoding");
  }
}

async function getGoogleSigningKey(kid: string): Promise<JsonWebKey> {
  const cacheKey = new Request(JWKS_URL, {
    headers: { Accept: "application/json" },
  });
  let response = await caches.default.match(cacheKey);
  if (!response) {
    response = await fetch(cacheKey);
    if (response.ok) {
      await caches.default.put(cacheKey, response.clone());
    }
  }
  if (!response.ok) {
    throw new ApiError(
      502,
      "GOOGLE_KEYS_UNAVAILABLE",
      "Google sign-in verification is temporarily unavailable.",
    );
  }
  const data = (await response.json()) as {
    keys?: Array<JsonWebKey & { kid?: string; alg?: string }>;
  };
  const key = data.keys?.find(
    (candidate) => candidate.kid === kid && candidate.alg === "RS256",
  );
  if (!key) {
    throw ApiError.unauthorized("Google signing key was not found");
  }
  return key;
}

/**
 * Revoke a token (access or refresh) so Google invalidates it.
 */
export async function revokeToken(token: string): Promise<void> {
  await fetch(REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  });
  // We don't throw on failure — the user still wants to disconnect locally.
}

/**
 * Get a valid access token for a user, auto-refreshing if expired.
 * Decrypts the stored token, checks expiry, and refreshes if needed.
 * Throws if the account is revoked or refresh fails.
 */
export async function getValidAccessToken(
  db: Database,
  env: EnvConfig,
  userId: string,
  requiredScopes: string[] = [],
): Promise<string> {
  const [account] = await db
    .select()
    .from(googleAccounts)
    .where(eq(googleAccounts.userId, userId));

  if (!account || account.revokedAt) {
    throw new ApiError(
      401,
      "GOOGLE_REAUTH_REQUIRED",
      "Google account not connected or revoked. Please reconnect.",
    );
  }

  const grantedScopes = new Set(account.scopes.split(/\s+/).filter(Boolean));
  const missingScopes = requiredScopes.filter(
    (scope) => !grantedScopes.has(scope),
  );
  if (missingScopes.length > 0) {
    throw new ApiError(
      403,
      "GOOGLE_PERMISSION_REQUIRED",
      "Google permissions are missing for this feature. Please reconnect and approve the requested access.",
      { missingScopes },
    );
  }

  // Check if the current access token is still valid (with 5-min buffer)
  const now = new Date();
  const bufferMs = 5 * 60 * 1000;
  const isExpired =
    !account.tokenExpiry || new Date(account.tokenExpiry).getTime() < now.getTime() + bufferMs;

  if (!isExpired) {
    return decryptToken(account.encryptedAccessToken, env.encryptionKey);
  }

  // Token is expired — try to refresh
  if (!account.encryptedRefreshToken) {
    throw new ApiError(
      401,
      "GOOGLE_REAUTH_REQUIRED",
      "No refresh token available. Please reconnect your Google account.",
    );
  }

  const refreshToken = await decryptToken(
    account.encryptedRefreshToken,
    env.encryptionKey,
  );

  try {
    const { access_token, expires_in } = await refreshAccessToken(env, refreshToken);
    const newExpiry = new Date(now.getTime() + expires_in * 1000);
    const encryptedAccessToken = await encryptToken(access_token, env.encryptionKey);

    await db
      .update(googleAccounts)
      .set({
        encryptedAccessToken,
        tokenExpiry: newExpiry,
        updatedAt: now,
      })
      .where(eq(googleAccounts.id, account.id));

    return access_token;
  } catch (err) {
    if (err instanceof ApiError && err.code === "GOOGLE_REAUTH_REQUIRED") {
      await db
        .update(googleAccounts)
        .set({
          revokedAt: new Date(),
          encryptedAccessToken: "",
          encryptedRefreshToken: null,
          updatedAt: new Date(),
        })
        .where(eq(googleAccounts.id, account.id));
      throw err;
    }
    if (err instanceof ApiError) throw err;
    throw new ApiError(
      401,
      "GOOGLE_REAUTH_REQUIRED",
      "Failed to refresh Google token. Please reconnect your account.",
    );
  }
}

/**
 * Store or update Google account credentials for a user.
 * Encrypts tokens before storage.
 */
export async function storeGoogleAccount(
  db: Database,
  env: EnvConfig,
  userId: string,
  payload: IdTokenPayload,
  tokens: TokenResponse,
): Promise<void> {
  const encryptedAccessToken = await encryptToken(
    tokens.access_token,
    env.encryptionKey,
  );
  const encryptedRefreshToken = tokens.refresh_token
    ? await encryptToken(tokens.refresh_token, env.encryptionKey)
    : undefined;

  const tokenExpiry = new Date(
    Date.now() + (tokens.expires_in ?? 3600) * 1000,
  );

  // Check if a Google account already exists for this user
  const [existing] = await db
    .select()
    .from(googleAccounts)
    .where(eq(googleAccounts.userId, userId));

  if (existing) {
    await db
      .update(googleAccounts)
      .set({
        googleId: payload.sub,
        email: payload.email,
        encryptedAccessToken,
        encryptedRefreshToken:
          encryptedRefreshToken ?? existing.encryptedRefreshToken,
        tokenExpiry,
        scopes: tokens.scope,
        revokedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(googleAccounts.id, existing.id));
  } else {
    await db.insert(googleAccounts).values({
      userId,
      googleId: payload.sub,
      email: payload.email,
      encryptedAccessToken,
      encryptedRefreshToken,
      tokenExpiry,
      scopes: tokens.scope,
    });
  }
}

/**
 * Check whether a user has a connected, non-revoked Google account.
 */
export async function getGoogleAccountStatus(
  db: Database,
  userId: string,
): Promise<{
  connected: boolean;
  email?: string;
  scopes?: string;
  capabilities: {
    gmailRead: boolean;
    gmailSend: boolean;
    calendarEvents: boolean;
    calendarAvailability: boolean;
  };
}> {
  const [account] = await db
    .select({
      email: googleAccounts.email,
      scopes: googleAccounts.scopes,
      revokedAt: googleAccounts.revokedAt,
    })
    .from(googleAccounts)
    .where(eq(googleAccounts.userId, userId));

  if (!account || account.revokedAt) {
    return {
      connected: false,
      capabilities: {
        gmailRead: false,
        gmailSend: false,
        calendarEvents: false,
        calendarAvailability: false,
      },
    };
  }

  const scopes = new Set(account.scopes.split(/\s+/).filter(Boolean));

  return {
    connected: true,
    email: account.email,
    scopes: account.scopes,
    capabilities: {
      gmailRead: scopes.has(GOOGLE_SCOPE.GMAIL_READ),
      gmailSend: scopes.has(GOOGLE_SCOPE.GMAIL_SEND),
      calendarEvents: scopes.has(GOOGLE_SCOPE.CALENDAR_EVENTS),
      calendarAvailability: scopes.has(GOOGLE_SCOPE.CALENDAR_AVAILABILITY),
    },
  };
}

/**
 * Revoke and mark the Google account as disconnected.
 */
export async function revokeGoogleAccount(
  db: Database,
  env: EnvConfig,
  userId: string,
): Promise<void> {
  const [account] = await db
    .select()
    .from(googleAccounts)
    .where(eq(googleAccounts.userId, userId));

  if (!account) return;

  // Best-effort token revocation
  try {
    const accessToken = await decryptToken(
      account.encryptedAccessToken,
      env.encryptionKey,
    );
    await revokeToken(accessToken);
  } catch {
    // Ignore — we still mark as revoked locally
  }

  if (account.encryptedRefreshToken) {
    try {
      const refreshToken = await decryptToken(
        account.encryptedRefreshToken,
        env.encryptionKey,
      );
      await revokeToken(refreshToken);
    } catch {
      // Ignore
    }
  }

  await db
    .update(googleAccounts)
    .set({
      revokedAt: new Date(),
      encryptedAccessToken: "",
      encryptedRefreshToken: null,
      updatedAt: new Date(),
    })
    .where(eq(googleAccounts.id, account.id));
}

/**
 * Build an AuthUser object from a User table row.
 */
export function toAuthUser(user: schema.User): AuthUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    timezone: user.timezone,
    workingHoursStart: user.workingHoursStart,
    workingHoursEnd: user.workingHoursEnd,
  };
}
