/**
 * Session management — create, validate, and destroy sessions.
 * Tokens are hashed (SHA-256) before storage; the raw token lives
 * only in an httpOnly cookie.
 */

import { eq, and, gt } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type * as schema from "@/db/schema";
import { authSessions, users } from "@/db/schema";
import { generateSessionToken, hashToken } from "@/lib/crypto";
import type { AppBindings, AuthUser } from "@/types";

type Database = NeonHttpDatabase<typeof schema>;

export const SESSION_COOKIE = "sccci_crm_session";
const SESSION_MAX_AGE = 7 * 24 * 60 * 60; // 7 days in seconds

/**
 * Create a new session for a user and return the raw token.
 * Only the hash is stored in the database.
 */
export async function createSession(
  db: Database,
  userId: string,
  sessionSecret: string,
  userAgent?: string,
): Promise<string> {
  const token = generateSessionToken();
  const tokenHash = await hashToken(token, sessionSecret);
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE * 1000);

  await db.insert(authSessions).values({
    userId,
    tokenHash,
    expiresAt,
    userAgent: userAgent ?? null,
  });

  return token;
}

/**
 * Validate a raw session token. Returns the userId if the session is valid
 * and non-expired, otherwise null.
 */
export async function validateSession(
  db: Database,
  token: string,
  sessionSecret: string,
): Promise<{ userId: string } | null> {
  const tokenHash = await hashToken(token, sessionSecret);
  const [session] = await db
    .select({ userId: authSessions.userId })
    .from(authSessions)
    .where(
      and(
        eq(authSessions.tokenHash, tokenHash),
        gt(authSessions.expiresAt, new Date()),
      ),
    );

  return session ?? null;
}

/**
 * Delete a session from the database (logout).
 */
export async function deleteSession(
  db: Database,
  token: string,
  sessionSecret: string,
): Promise<void> {
  const tokenHash = await hashToken(token, sessionSecret);
  await db
    .delete(authSessions)
    .where(eq(authSessions.tokenHash, tokenHash));
}

/**
 * Look up the authenticated user for a given session token.
 * Returns a safe AuthUser object (no sensitive fields).
 */
export async function getAuthUser(
  db: Database,
  token: string,
  sessionSecret: string,
): Promise<AuthUser | null> {
  const session = await validateSession(db, token, sessionSecret);
  if (!session) return null;

  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      avatarUrl: users.avatarUrl,
      timezone: users.timezone,
      workingHoursStart: users.workingHoursStart,
      workingHoursEnd: users.workingHoursEnd,
    })
    .from(users)
    .where(eq(users.id, session.userId));

  return user ?? null;
}

/**
 * Set the session cookie on the response.
 * httpOnly + Secure in production. SameSite=None is required because the
 * production frontend and API currently use different sites.
 */
export function setSessionCookie(
  c: Context<AppBindings>,
  token: string,
  isSecureDeployment: boolean,
): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: isSecureDeployment ? "None" : "Lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
    secure: isSecureDeployment,
  });
}

/**
 * Clear the session cookie.
 */
export function clearSessionCookie(c: Context<AppBindings>): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

/**
 * Read the session token from the incoming request cookie.
 */
export function readSessionCookie(c: Context<AppBindings>): string | undefined {
  return getCookie(c, SESSION_COOKIE);
}
