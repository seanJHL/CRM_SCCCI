/**
 * Audit logging — records sensitive user actions (email sends, calendar
 * events, account changes) with PII-masked details.
 */

import { desc, eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import type * as schema from "@/db/schema";
import { auditLogs } from "@/db/schema";
import { maskPiiInObject } from "@/lib/pii-masker";

type Database = NeonHttpDatabase<typeof schema>;

/** Standard audit action names. */
export const AuditAction = {
  EMAIL_SEND: "email.send",
  EMAIL_REPLY_SUGGEST: "email.reply_suggest",
  EMAIL_CLASSIFY: "email.classify",
  EMAIL_STATUS_UPDATE: "email.status_update",
  CALENDAR_CREATE: "calendar.create",
  CALENDAR_UPDATE: "calendar.update",
  CALENDAR_CANCEL: "calendar.cancel",
  ACCOUNT_DISCONNECT: "account.disconnect",
  DATA_DELETE: "data.delete",
} as const;

/**
 * Log an action to the audit trail. Details are PII-masked before storage.
 */
export async function logAction(
  db: Database,
  userId: string,
  action: string,
  resourceType: string,
  resourceId: string | null,
  details?: unknown,
): Promise<void> {
  await db.insert(auditLogs).values({
    userId,
    action,
    resourceType,
    resourceId: resourceId ?? null,
    details: details ? maskPiiInObject(details) : null,
  });
}

/**
 * Fetch paginated audit logs for a user.
 */
export async function getAuditLogs(
  db: Database,
  userId: string,
  limit = 50,
  offset = 0,
) {
  return db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.userId, userId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit)
    .offset(offset);
}
