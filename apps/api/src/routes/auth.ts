/**
 * Auth routes — Google OAuth 2.0 sign-in, session management,
 * profile updates, logout, and account disconnection.
 */

import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { AppBindings } from "@/types";
import { createDatabase } from "@/db";
import { authSessions, googleAccounts, users } from "@/db/schema";
import { emailThreads, suggestedReplies, meetingRequests, calendarBookings } from "@/db/schema";
import { ApiError, ok } from "@/lib/utils";
import { getEnv } from "@/lib/env";
import {
  setSessionCookie,
  clearSessionCookie,
  readSessionCookie,
  createSession,
  deleteSession,
} from "@/lib/session";
import {
  getAuthUrl,
  assertGoogleOAuthConfigured,
  exchangeCode,
  verifyIdToken,
  storeGoogleAccount,
  getGoogleAccountStatus,
  revokeGoogleAccount,
  toAuthUser,
} from "@/lib/google-oauth";
import { logAction, AuditAction } from "@/lib/audit";
import { authMiddleware } from "@/middleware/auth";
import {
  createPkceChallenge,
  randomUrlSafeToken,
  secureEqual,
} from "@/lib/crypto";

const authRoutes = new Hono<AppBindings>();

// --- Zod schemas ---

const profileUpdateSchema = z.object({
  timezone: z
    .string()
    .min(1)
    .max(100)
    .refine((v) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: v }).format();
        return true;
      } catch {
        return false;
      }
    }, "Invalid IANA timezone")
    .optional(),
  workingHoursStart: z
    .string()
    .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Must be HH:mm")
    .optional(),
  workingHoursEnd: z
    .string()
    .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Must be HH:mm")
    .optional(),
});

// These endpoints require a valid session. The middleware also performs an
// Origin check for state-changing requests made with credential cookies.
authRoutes.use("/me", authMiddleware);
authRoutes.use("/logout", authMiddleware);
authRoutes.use("/disconnect", authMiddleware);

// --- GET /api/auth/google — initiate OAuth ---

authRoutes.get("/google", async (c) => {
  const env = getEnv(c.env);
  assertGoogleOAuthConfigured(env);

  const state = randomUrlSafeToken();
  const nonce = randomUrlSafeToken();
  const codeVerifier = randomUrlSafeToken(48);
  const codeChallenge = await createPkceChallenge(codeVerifier);

  const temporaryCookie = {
    httpOnly: true,
    sameSite: "Lax" as const,
    path: "/",
    maxAge: 600,
    secure: env.isSecureDeployment,
  };
  setCookie(c, "oauth_state", state, temporaryCookie);
  setCookie(c, "oauth_nonce", nonce, temporaryCookie);
  setCookie(c, "oauth_code_verifier", codeVerifier, temporaryCookie);

  const authUrl = getAuthUrl(env, { state, nonce, codeChallenge });
  return c.redirect(authUrl);
});

// --- GET /api/auth/google/callback — handle OAuth callback ---

authRoutes.get("/google/callback", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);

  const code = c.req.query("code");
  const state = c.req.query("state");
  const error = c.req.query("error");

  // User denied consent
  if (error) {
    clearOAuthCookies(c);
    const frontendUrl = getFrontendUrl(env.corsOrigin);
    return c.redirect(
      `${frontendUrl}/login?error=${encodeURIComponent(error)}`,
    );
  }

  if (!code || !state) {
    throw ApiError.badRequest("Missing code or state parameter");
  }

  // Verify state matches the cookie (CSRF protection)
  const cookieState = getCookie(c, "oauth_state");
  const nonce = getCookie(c, "oauth_nonce");
  const codeVerifier = getCookie(c, "oauth_code_verifier");
  if (
    !cookieState ||
    !nonce ||
    !codeVerifier ||
    !(await secureEqual(cookieState, state))
  ) {
    throw ApiError.badRequest("Invalid OAuth state — possible CSRF attack");
  }

  clearOAuthCookies(c);

  // Exchange code for tokens
  const tokens = await exchangeCode(env, code, codeVerifier);

  // Verify the id_token signature and claims before using its identity.
  const payload = await verifyIdToken(env, tokens.id_token, nonce);

  if (!payload.email) {
    throw ApiError.badRequest("Google account has no email address");
  }

  // Google `sub` is the stable identity. Email addresses can change or be
  // reassigned, so prefer an existing Google-account link before email.
  const [existingGoogleAccount] = await db
    .select({ userId: googleAccounts.userId, googleId: googleAccounts.googleId })
    .from(googleAccounts)
    .where(eq(googleAccounts.googleId, payload.sub));
  const [existingUser] = existingGoogleAccount
    ? await db
        .select()
        .from(users)
        .where(eq(users.id, existingGoogleAccount.userId))
    : await db.select().from(users).where(eq(users.email, payload.email));

  if (existingUser && !existingGoogleAccount) {
    const [differentGoogleAccount] = await db
      .select({ googleId: googleAccounts.googleId })
      .from(googleAccounts)
      .where(eq(googleAccounts.userId, existingUser.id));
    if (
      differentGoogleAccount &&
      differentGoogleAccount.googleId !== payload.sub
    ) {
      throw new ApiError(
        409,
        "GOOGLE_ACCOUNT_MISMATCH",
        "This email is already linked to a different Google account.",
      );
    }
  }

  let userId: string;
  if (existingUser) {
    await db
      .update(users)
      .set({
        name: payload.name,
        avatarUrl: payload.picture ?? null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, existingUser.id));
    userId = existingUser.id;
  } else {
    const [newUser] = await db
      .insert(users)
      .values({
        email: payload.email,
        name: payload.name,
        avatarUrl: payload.picture ?? null,
      })
      .returning();
    userId = newUser!.id;
  }

  // Store encrypted Google credentials
  await storeGoogleAccount(db, env, userId, payload, tokens);

  // Create session
  const token = await createSession(
    db,
    userId,
    env.sessionSecret,
    c.req.header("user-agent") ?? undefined,
  );
  setSessionCookie(c, token, env.isSecureDeployment);

  // Redirect to frontend CRM dashboard
  const frontendUrl = getFrontendUrl(env.corsOrigin);
  return c.redirect(`${frontendUrl}/crm`);
});

// --- GET /api/auth/me — current user + Google connection status ---

authRoutes.get("/me", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);

  const user = c.get("user");

  const googleStatus = await getGoogleAccountStatus(db, user.id);

  return c.json(
    ok({
      user,
      google: googleStatus,
    }),
  );
});

// --- PATCH /api/auth/me — update profile (timezone, working hours) ---

authRoutes.patch("/me", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);

  const user = c.get("user");

  const body = profileUpdateSchema.parse(await c.req.json());
  const workingHoursStart = body.workingHoursStart ?? user.workingHoursStart;
  const workingHoursEnd = body.workingHoursEnd ?? user.workingHoursEnd;
  if (workingHoursStart >= workingHoursEnd) {
    throw ApiError.badRequest("Working-hours end must be after the start");
  }

  const [updated] = await db
    .update(users)
    .set({
      ...body,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id))
    .returning();

  return c.json(ok({ user: toAuthUser(updated!) }));
});

// --- POST /api/auth/logout ---

authRoutes.post("/logout", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);

  const token = readSessionCookie(c);
  if (token) {
    await deleteSession(db, token, env.sessionSecret);
  }
  clearSessionCookie(c);

  return c.json(ok({ loggedOut: true }));
});

// --- POST /api/auth/disconnect — revoke Google account + delete CRM data ---

authRoutes.post("/disconnect", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);

  const user = c.get("user");

  // Revoke tokens and mark account as disconnected
  await revokeGoogleAccount(db, env, user.id);

  // Delete all CRM data for this user
  // (suggestedReplies and meetingRequests cascade from emailThreads, but
  //  also have direct userId FKs — delete explicitly to be thorough)
  await db.delete(suggestedReplies).where(eq(suggestedReplies.userId, user.id));
  await db.delete(meetingRequests).where(eq(meetingRequests.userId, user.id));
  await db.delete(emailThreads).where(eq(emailThreads.userId, user.id));
  await db.delete(calendarBookings).where(eq(calendarBookings.userId, user.id));

  // Log the disconnection (before we delete the session)
  await logAction(db, user.id, AuditAction.ACCOUNT_DISCONNECT, "google_account", null, {
    email: user.email,
    timestamp: new Date().toISOString(),
  });

  // End every session associated with the disconnected account.
  await db.delete(authSessions).where(eq(authSessions.userId, user.id));
  clearSessionCookie(c);

  return c.json(ok({ disconnected: true }));
});

// --- Helper: extract the frontend URL from CORS_ORIGIN ---

function getFrontendUrl(corsOrigin: string): string {
  const origins = corsOrigin
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => /^https?:\/\//.test(origin));
  return origins[0] || "http://localhost:3001";
}

function clearOAuthCookies(c: Parameters<typeof deleteCookie>[0]): void {
  deleteCookie(c, "oauth_state", { path: "/" });
  deleteCookie(c, "oauth_nonce", { path: "/" });
  deleteCookie(c, "oauth_code_verifier", { path: "/" });
}

export default authRoutes;
