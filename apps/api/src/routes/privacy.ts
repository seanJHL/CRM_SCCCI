/**
 * Privacy routes — audit log viewer, data access summary,
 * and full data deletion. Empowers users with transparency and control.
 */

import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import type { AppBindings } from "@/types";
import { createDatabase } from "@/db";
import {
  emailThreads,
  suggestedReplies,
  meetingRequests,
  calendarBookings,
  auditLogs,
  users,
} from "@/db/schema";
import { ok } from "@/lib/utils";
import { getEnv } from "@/lib/env";
import { revokeGoogleAccount } from "@/lib/google-oauth";
import { getAuditLogs, logAction, AuditAction } from "@/lib/audit";
import { clearSessionCookie } from "@/lib/session";

const privacyRoute = new Hono<AppBindings>();

// --- GET /audit-logs — paginated audit log for the current user ---

privacyRoute.get("/audit-logs", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const userId = c.get("userId");

  const limit = Math.min(Number(c.req.query("limit") ?? "50"), 200);
  const offset = Number(c.req.query("offset") ?? "0");

  const logs = await getAuditLogs(db, userId, limit, offset);

  return c.json(ok({ logs, limit, offset }));
});

// --- GET /data-access — summary of what data is stored ---

privacyRoute.get("/data-access", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const userId = c.get("userId");

  // Count records in each table
  const threads = await db
    .select({ count: sql<number>`count(*)` })
    .from(emailThreads)
    .where(eq(emailThreads.userId, userId));

  const replies = await db
    .select({ count: sql<number>`count(*)` })
    .from(suggestedReplies)
    .where(eq(suggestedReplies.userId, userId));

  const meetings = await db
    .select({ count: sql<number>`count(*)` })
    .from(meetingRequests)
    .where(eq(meetingRequests.userId, userId));

  const bookings = await db
    .select({ count: sql<number>`count(*)` })
    .from(calendarBookings)
    .where(eq(calendarBookings.userId, userId));

  const logs = await db
    .select({ count: sql<number>`count(*)` })
    .from(auditLogs)
    .where(eq(auditLogs.userId, userId));

  return c.json(
    ok({
      summary: {
        emailThreads: Number(threads[0]?.count ?? 0),
        suggestedReplies: Number(replies[0]?.count ?? 0),
        meetingRequests: Number(meetings[0]?.count ?? 0),
        calendarBookings: Number(bookings[0]?.count ?? 0),
        auditLogs: Number(logs[0]?.count ?? 0),
      },
      description:
        "The CRM stores cached Gmail thread metadata (subject, sender, snippet, classification), " +
        "suggested reply drafts, detected meeting requests, calendar bookings created through the CRM, " +
        "and audit logs for sensitive actions. OAuth tokens are encrypted at rest. " +
        "Email bodies are fetched on demand and are not persisted. No data is sent to external AI services. " +
        "The use of information received from Google Workspace APIs adheres to the Google API Services " +
        "User Data Policy, including the Limited Use requirements.",
    }),
  );
});

// --- DELETE /data — delete all CRM data and disconnect Google ---

privacyRoute.delete("/data", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const userId = c.get("userId");
  const user = c.get("user");

  // Log the deletion first (while we still have the session)
  await logAction(db, userId, AuditAction.DATA_DELETE, "all", null, {
    email: user.email,
    timestamp: new Date().toISOString(),
  });

  // Revoke Google tokens and mark account as disconnected
  await revokeGoogleAccount(db, env, userId);

  // Deleting the user cascades through sessions, encrypted Google account
  // credentials, cached CRM data, bookings, and audit logs. This also ends
  // every active session, not only the current browser.
  await db.delete(users).where(eq(users.id, userId));
  clearSessionCookie(c);

  return c.json(
    ok({
      deleted: true,
      message:
        "All CRM data has been deleted and your Google account has been disconnected. " +
        "You will need to sign in again to use the CRM.",
    }),
  );
});

export default privacyRoute;
