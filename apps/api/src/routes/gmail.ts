/**
 * Gmail routes — thread retrieval, classification, reply generation,
 * reply sending (with user confirmation), and bulk management.
 */

import { Hono } from "hono";
import { z } from "zod";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import type { AppBindings } from "@/types";
import { createDatabase } from "@/db";
import {
  emailThreads,
  suggestedReplies,
  meetingRequests,
} from "@/db/schema";
import { ApiError, ok } from "@/lib/utils";
import { getEnv } from "@/lib/env";
import {
  getValidAccessToken,
  GOOGLE_SCOPE,
} from "@/lib/google-oauth";
import {
  gmailListThreads,
  gmailGetThread,
  gmailSendReply,
  type GmailMessage,
} from "@/lib/google-api";
import { classifyEmail } from "@/lib/email-classifier";
import { generateReply, regenerateReply } from "@/lib/reply-generator";
import { logAction, AuditAction } from "@/lib/audit";

const gmailRoute = new Hono<AppBindings>();

// --- Zod schemas ---

const threadUpdateSchema = z.object({
  category: z
    .enum(["billing", "scheduling", "urgent", "support", "newsletter", "general"])
    .optional(),
  priority: z.enum(["critical", "high", "normal", "low"]).optional(),
  status: z.enum(["unread", "read", "replied", "scheduled", "archived", "dismissed"]).optional(),
});

const replyGenerateSchema = z.object({
  regenerate: z.boolean().optional(),
  currentBody: z.string().max(100_000).optional(),
});

const replySendSchema = z.object({
  body: z.string().trim().min(1, "Reply body is required").max(100_000),
  to: z.string().email().optional(),
  draftId: z.string().uuid().optional(),
  confirmed: z.literal(true),
});

const bulkUpdateSchema = z.object({
  threadIds: z.array(z.string().min(1)).min(1).max(100),
  updates: threadUpdateSchema.refine(
    (updates) => Object.keys(updates).length > 0,
    "At least one update is required",
  ),
});

const bulkReplySchema = z.object({
  threadIds: z.array(z.string().min(1)).min(1).max(20),
});

// --- GET / — list threads (fetches from Gmail, caches + classifies) ---

gmailRoute.get("/", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const userId = c.get("userId");

  // Query params for filtering
  const category = c.req.query("category");
  const priority = c.req.query("priority");
  const status = c.req.query("status");
  const requiresResponse = c.req.query("requiresResponse");
  const sender = c.req.query("sender");
  const refresh = c.req.query("refresh") === "true";

  // If we have cached threads and not refreshing, return them
  if (!refresh) {
    const conditions = [eq(emailThreads.userId, userId)];
    if (category) conditions.push(eq(emailThreads.category, category));
    if (priority) conditions.push(eq(emailThreads.priority, priority));
    if (status) conditions.push(eq(emailThreads.status, status));
    if (requiresResponse === "true") conditions.push(eq(emailThreads.requiresResponse, true));
    if (sender) conditions.push(sql`${emailThreads.fromEmail} ILIKE ${`%${sender}%`}`);

    const cached = await db
      .select()
      .from(emailThreads)
      .where(and(...conditions))
      .orderBy(desc(emailThreads.lastMessageDate));

    const [hasCachedThreads] = await db
      .select({ id: emailThreads.id })
      .from(emailThreads)
      .where(eq(emailThreads.userId, userId))
      .limit(1);
    if (hasCachedThreads) {
      return c.json(ok({ threads: cached, cached: true }));
    }
  }

  // Fetch from Gmail
  const accessToken = await getValidAccessToken(db, env, userId, [
    GOOGLE_SCOPE.GMAIL_READ,
  ]);
  const threadSummaries = await gmailListThreads(accessToken, 20);

  // Keep Gmail payload memory bounded by loading only a few full threads at a
  // time. A thread can contain large MIME bodies and attachments.
  const threadDetails = await mapSettledWithConcurrency(
    threadSummaries,
    4,
    (thread) => gmailGetThread(accessToken, thread.id),
  );

  const threads = [];
  for (const result of threadDetails) {
    if (result.status !== "fulfilled") continue;
    const detail = result.value;
    const lastIncoming = [...detail.messages]
      .reverse()
      .find((message) => !message.labelIds.includes("SENT"));
    const classificationText = detail.messages
      .slice(-4)
      .map((message) => message.bodyText || message.snippet)
      .join("\n\n")
      .slice(0, 20_000);

    // Classify
    const classification = classifyEmail(
      detail.subject,
      lastIncoming?.fromEmail ?? detail.fromEmail,
      classificationText || detail.snippet,
    );
    const latestIsIncoming = !detail.lastMessage.labelIds.includes("SENT");
    const requiresResponse = latestIsIncoming && classification.requiresResponse;

    // Upsert to DB
    const [existing] = await db
      .select()
      .from(emailThreads)
      .where(
        and(
          eq(emailThreads.userId, userId),
          eq(emailThreads.gmailThreadId, detail.id),
        ),
      );

    const importanceReasons = [...classification.importanceReasons];
    if (existing?.categoryManuallySet) {
      importanceReasons.push("Category was set manually");
    }
    if (existing?.priorityManuallySet) {
      importanceReasons.push("Priority was set manually");
    }
    const importanceReason = JSON.stringify(importanceReasons);

    if (existing) {
      const [updated] = await db
        .update(emailThreads)
        .set({
          subject: detail.subject,
          snippet: lastIncoming?.snippet ?? detail.snippet,
          fromEmail: lastIncoming?.fromEmail ?? detail.fromEmail,
          fromName: lastIncoming?.fromName ?? detail.fromName,
          lastMessageDate: detail.lastMessageDate,
          ...(!existing.categoryManuallySet && {
            category: classification.category,
          }),
          ...(!existing.priorityManuallySet && {
            priority: classification.priority,
          }),
          requiresResponse,
          ...(latestIsIncoming &&
            detail.lastMessageDate > (existing.lastMessageDate ?? new Date(0)) && {
              status: detail.hasUnread ? "unread" : "read",
            }),
          importanceReason,
          hasUnread: detail.hasUnread,
          updatedAt: new Date(),
        })
        .where(eq(emailThreads.id, existing.id))
        .returning();
      threads.push(updated);
    } else {
      const [created] = await db
        .insert(emailThreads)
        .values({
          userId,
          gmailThreadId: detail.id,
          subject: detail.subject,
          snippet: detail.snippet,
          fromEmail: lastIncoming?.fromEmail ?? detail.fromEmail,
          fromName: lastIncoming?.fromName ?? detail.fromName,
          lastMessageDate: detail.lastMessageDate,
          category: classification.category,
          priority: classification.priority,
          requiresResponse,
          status: detail.hasUnread ? "unread" : "read",
          importanceReason,
          hasUnread: detail.hasUnread,
        })
        .returning();
      threads.push(created);
    }

    // If meeting request detected, store it
    if (classification.hasMeetingRequest) {
      await db
        .insert(meetingRequests)
        .values({
          userId,
          threadId: threads[threads.length - 1]!.id,
          rawText: `${detail.subject} ${lastIncoming?.snippet ?? detail.snippet}`.slice(0, 2_000),
          timezone: c.get("user").timezone,
          status: "detected",
        })
        .onConflictDoNothing();
    }
  }

  // Apply filters
  let filtered = threads;
  if (category) filtered = filtered.filter((t) => t.category === category);
  if (priority) filtered = filtered.filter((t) => t.priority === priority);
  if (status) filtered = filtered.filter((t) => t.status === status);
  if (requiresResponse === "true") filtered = filtered.filter((t) => t.requiresResponse);
  if (sender) filtered = filtered.filter((t) => t.fromEmail?.includes(sender));

  return c.json(ok({ threads: filtered, cached: false }));
});

// --- GET /:threadId — full thread detail ---

gmailRoute.get("/:threadId", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const userId = c.get("userId");
  const threadId = c.req.param("threadId");

  // Get cached thread record
  const [cached] = await db
    .select()
    .from(emailThreads)
    .where(
      and(
        eq(emailThreads.userId, userId),
        eq(emailThreads.gmailThreadId, threadId),
      ),
    );

  // Fetch full thread from Gmail
  const accessToken = await getValidAccessToken(db, env, userId, [
    GOOGLE_SCOPE.GMAIL_READ,
  ]);
  const detail = await gmailGetThread(accessToken, threadId);

  // Get suggested replies for this thread
  const replies = cached
    ? await db
        .select()
        .from(suggestedReplies)
        .where(eq(suggestedReplies.threadId, cached.id))
        .orderBy(desc(suggestedReplies.createdAt))
    : [];

  // Get meeting requests for this thread
  const meetings = cached
    ? await db
        .select()
        .from(meetingRequests)
        .where(eq(meetingRequests.threadId, cached.id))
    : [];

  // Parse importance reasons
  const importanceReasons = parseImportanceReasons(cached?.importanceReason);

  return c.json(
    ok({
      thread: detail,
      classification: cached
        ? {
            category: cached.category,
            priority: cached.priority,
            requiresResponse: cached.requiresResponse,
            importanceReasons,
            hasUnread: cached.hasUnread,
            status: cached.status,
          }
        : null,
      replies,
      meetingRequests: meetings,
    }),
  );
});

// --- PATCH /:threadId — manual update of category/priority/status ---

gmailRoute.patch("/:threadId", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const userId = c.get("userId");
  const threadId = c.req.param("threadId");
  const body = threadUpdateSchema.parse(await c.req.json());

  const [cached] = await db
    .select()
    .from(emailThreads)
    .where(
      and(
        eq(emailThreads.userId, userId),
        eq(emailThreads.gmailThreadId, threadId),
      ),
    );

  if (!cached) {
    throw ApiError.notFound("Thread not found in cache");
  }

  const [updated] = await db
    .update(emailThreads)
    .set({
      ...body,
      ...(body.status &&
        ["replied", "scheduled", "dismissed"].includes(body.status) && {
          requiresResponse: false,
        }),
      ...(body.category && { categoryManuallySet: true }),
      ...(body.priority && { priorityManuallySet: true }),
      ...((body.category || body.priority) && {
        importanceReason: JSON.stringify([
          ...parseImportanceReasons(cached.importanceReason).filter(
            (reason) => !reason.toLowerCase().includes("set manually"),
          ),
          ...(body.category ? ["Category was set manually"] : []),
          ...(body.priority ? ["Priority was set manually"] : []),
        ]),
      }),
      updatedAt: new Date(),
    })
    .where(eq(emailThreads.id, cached.id))
    .returning();

  // Log status update
  if (body.status) {
    await logAction(db, userId, AuditAction.EMAIL_STATUS_UPDATE, "email_thread", cached.id, {
      status: body.status,
      threadId,
    });
  }

  return c.json(ok({ thread: updated }));
});

// --- POST /:threadId/reply — generate suggested reply ---

gmailRoute.post("/:threadId/reply", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const userId = c.get("userId");
  const user = c.get("user");
  const threadId = c.req.param("threadId");
  const { regenerate, currentBody } = replyGenerateSchema.parse(await c.req.json().catch(() => ({})));

  const [cached] = await db
    .select()
    .from(emailThreads)
    .where(
      and(
        eq(emailThreads.userId, userId),
        eq(emailThreads.gmailThreadId, threadId),
      ),
    );

  if (!cached) {
    throw ApiError.notFound("Thread not found in cache");
  }

  const accessToken = await getValidAccessToken(db, env, userId, [
    GOOGLE_SCOPE.GMAIL_READ,
  ]);
  const detail = await gmailGetThread(accessToken, threadId);
  const latestIncoming = [...detail.messages]
    .reverse()
    .find((message) => !message.labelIds.includes("SENT"));

  const replyParams = {
    category: cached.category as "billing" | "scheduling" | "urgent" | "support" | "newsletter" | "general",
    subject: cached.subject ?? "",
    senderName: cached.fromName ?? "",
    myName: user.name,
    latestMessage:
      latestIncoming?.bodyText || latestIncoming?.snippet || cached.snippet || "",
  };

  const { body: replyBody, template } = regenerate && currentBody
    ? regenerateReply({ ...replyParams, currentBody })
    : generateReply(replyParams);

  // Store the draft
  const [draft] = await db
    .insert(suggestedReplies)
    .values({
      threadId: cached.id,
      userId,
      body: replyBody,
      status: "draft",
    })
    .returning();

  await logAction(db, userId, AuditAction.EMAIL_CLASSIFY, "suggested_reply", draft.id, {
    threadId,
    template,
  });

  return c.json(ok({ reply: draft, template }));
});

// --- POST /:threadId/reply/send — send user-approved reply ---

gmailRoute.post("/:threadId/reply/send", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const userId = c.get("userId");
  const threadId = c.req.param("threadId");
  const {
    body: replyBody,
    to: requestedRecipient,
    draftId,
  } = replySendSchema.parse(await c.req.json());

  const [cached] = await db
    .select()
    .from(emailThreads)
    .where(
      and(
        eq(emailThreads.userId, userId),
        eq(emailThreads.gmailThreadId, threadId),
      ),
    );

  if (!cached) {
    throw ApiError.notFound("Thread not found in cache");
  }

  // Fetch thread for threading headers
  const accessToken = await getValidAccessToken(db, env, userId, [
    GOOGLE_SCOPE.GMAIL_READ,
    GOOGLE_SCOPE.GMAIL_SEND,
  ]);
  const detail = await gmailGetThread(accessToken, threadId);
  const lastMessage = detail.lastMessage;
  const allowedRecipients = getThreadParticipants(detail.messages, c.get("user").email);
  const to = requestedRecipient ?? allowedRecipients[0];
  if (!to || !allowedRecipients.some((email) => email.toLowerCase() === to.toLowerCase())) {
    throw ApiError.badRequest(
      "Reply recipient must be a participant in the selected Gmail thread",
    );
  }

  let approvedDraftId = draftId;
  if (draftId) {
    const [draft] = await db
      .select()
      .from(suggestedReplies)
      .where(
        and(
          eq(suggestedReplies.id, draftId),
          eq(suggestedReplies.threadId, cached.id),
          eq(suggestedReplies.userId, userId),
        ),
      );
    if (!draft) throw ApiError.badRequest("Suggested reply draft was not found");
    await db
      .update(suggestedReplies)
      .set({ body: replyBody, status: "approved", approvedAt: new Date() })
      .where(eq(suggestedReplies.id, draft.id));
  } else {
    const [approved] = await db
      .insert(suggestedReplies)
      .values({
        threadId: cached.id,
        userId,
        body: replyBody,
        status: "approved",
        approvedAt: new Date(),
      })
      .returning({ id: suggestedReplies.id });
    approvedDraftId = approved!.id;
  }

  // Send via Gmail API — requires user-approved body, NOT auto-generated
  const result = await gmailSendReply(accessToken, {
    to,
    subject: cached.subject?.startsWith("Re: ") ? cached.subject : `Re: ${cached.subject ?? ""}`,
    body: replyBody,
    threadId,
    inReplyTo: lastMessage.messageId || null,
    references: lastMessage.references || lastMessage.messageId || null,
  });

  // Mark thread as replied
  await db
    .update(emailThreads)
    .set({
      status: "replied",
      requiresResponse: false,
      hasUnread: false,
      updatedAt: new Date(),
    })
    .where(eq(emailThreads.id, cached.id));

  // Update or create suggested reply record as sent
  await db
    .update(suggestedReplies)
    .set({ body: replyBody, status: "sent", sentAt: new Date() })
    .where(eq(suggestedReplies.id, approvedDraftId!));

  // Audit log (PII-masked via logAction)
  await logAction(db, userId, AuditAction.EMAIL_SEND, "email_thread", cached.id, {
    threadId,
    to,
    messageId: result.id,
  });

  return c.json(ok({ sent: true, messageId: result.id }));
});

// --- POST /bulk/classify — reclassify all cached threads ---

gmailRoute.post("/bulk/classify", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const userId = c.get("userId");

  const threads = await db
    .select()
    .from(emailThreads)
    .where(eq(emailThreads.userId, userId));

  let updated = 0;
  for (const thread of threads) {
    const classification = classifyEmail(
      thread.subject ?? "",
      thread.fromEmail ?? "",
      thread.snippet ?? "",
    );

    await db
      .update(emailThreads)
      .set({
        category: classification.category,
        priority: classification.priority,
        requiresResponse:
          classification.requiresResponse &&
          !["replied", "scheduled", "dismissed"].includes(thread.status),
        importanceReason: JSON.stringify(classification.importanceReasons),
        categoryManuallySet: false,
        priorityManuallySet: false,
        updatedAt: new Date(),
      })
      .where(eq(emailThreads.id, thread.id));

    updated++;
    await logAction(db, userId, AuditAction.EMAIL_CLASSIFY, "email_thread", thread.id, {
      category: classification.category,
      priority: classification.priority,
    });
  }

  return c.json(ok({ classified: updated, total: threads.length }));
});

// --- POST /bulk/update — apply status/category/priority to selected threads ---

gmailRoute.post("/bulk/update", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const userId = c.get("userId");
  const { threadIds, updates } = bulkUpdateSchema.parse(await c.req.json());

  const changed = await db
    .update(emailThreads)
    .set({
      ...updates,
      ...(updates.status &&
        ["replied", "scheduled", "dismissed"].includes(updates.status) && {
          requiresResponse: false,
        }),
      ...(updates.category && { categoryManuallySet: true }),
      ...(updates.priority && { priorityManuallySet: true }),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(emailThreads.userId, userId),
        inArray(emailThreads.gmailThreadId, threadIds),
      ),
    )
    .returning();

  await Promise.all(
    changed.map((thread) =>
      logAction(
        db,
        userId,
        AuditAction.EMAIL_STATUS_UPDATE,
        "email_thread",
        thread.id,
        { threadId: thread.gmailThreadId, updates },
      ),
    ),
  );

  return c.json(ok({ updated: changed.length, threads: changed }));
});

// --- POST /bulk/replies — create reviewable drafts; never sends email ---

gmailRoute.post("/bulk/replies", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const user = c.get("user");
  const { threadIds } = bulkReplySchema.parse(await c.req.json());
  const threads = await db
    .select()
    .from(emailThreads)
    .where(
      and(
        eq(emailThreads.userId, user.id),
        inArray(emailThreads.gmailThreadId, threadIds),
      ),
    );

  const drafts = [];
  for (const thread of threads) {
    const generated = generateReply({
      category: thread.category as Parameters<typeof generateReply>[0]["category"],
      subject: thread.subject ?? "",
      senderName: thread.fromName ?? "",
      myName: user.name,
      latestMessage: thread.snippet ?? "",
    });
    const [draft] = await db
      .insert(suggestedReplies)
      .values({
        threadId: thread.id,
        userId: user.id,
        body: generated.body,
        status: "draft",
      })
      .returning();
    drafts.push({ ...draft!, gmailThreadId: thread.gmailThreadId });
  }

  return c.json(
    ok({
      generated: drafts.length,
      drafts,
      message: "Drafts were generated for review. No email was sent.",
    }),
  );
});

// --- GET /meeting-requests — detected scheduling requests for dashboard ---

gmailRoute.get("/meeting-requests", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const userId = c.get("userId");
  const requests = await db
    .select({ request: meetingRequests, thread: emailThreads })
    .from(meetingRequests)
    .leftJoin(emailThreads, eq(meetingRequests.threadId, emailThreads.id))
    .where(eq(meetingRequests.userId, userId))
    .orderBy(desc(meetingRequests.createdAt));

  return c.json(ok({ meetingRequests: requests }));
});

// --- GET /stats — aggregate counts for dashboard ---

gmailRoute.get("/stats", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const userId = c.get("userId");

  const allThreads = await db
    .select()
    .from(emailThreads)
    .where(eq(emailThreads.userId, userId));

  const stats = {
    total: allThreads.length,
    unread: allThreads.filter((t) => t.hasUnread).length,
    urgent: allThreads.filter((t) => t.priority === "critical" || t.priority === "high").length,
    requiresResponse: allThreads.filter((t) => t.requiresResponse).length,
    byCategory: {
      billing: allThreads.filter((t) => t.category === "billing").length,
      scheduling: allThreads.filter((t) => t.category === "scheduling").length,
      urgent: allThreads.filter((t) => t.category === "urgent").length,
      support: allThreads.filter((t) => t.category === "support").length,
      newsletter: allThreads.filter((t) => t.category === "newsletter").length,
      general: allThreads.filter((t) => t.category === "general").length,
    },
    byStatus: {
      unread: allThreads.filter((t) => t.status === "unread").length,
      read: allThreads.filter((t) => t.status === "read").length,
      replied: allThreads.filter((t) => t.status === "replied").length,
      scheduled: allThreads.filter((t) => t.status === "scheduled").length,
      archived: allThreads.filter((t) => t.status === "archived").length,
      dismissed: allThreads.filter((t) => t.status === "dismissed").length,
    },
  };

  return c.json(ok({ stats }));
});

export default gmailRoute;

function parseImportanceReasons(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function getThreadParticipants(messages: GmailMessage[], myEmail: string): string[] {
  const mine = myEmail.toLowerCase();
  const participants = new Set<string>();
  for (const message of [...messages].reverse()) {
    const candidates = message.labelIds.includes("SENT")
      ? (message.to.match(
          /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
        ) ?? [])
      : [message.fromEmail];
    for (const candidate of candidates) {
      const email = candidate.trim().toLowerCase();
      if (email && email !== mine) participants.add(email);
    }
  }
  return [...participants];
}

async function mapSettledWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<Array<PromiseSettledResult<R>>> {
  const results = new Array<PromiseSettledResult<R>>(values.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (cursor < values.length) {
        const index = cursor;
        cursor += 1;
        try {
          results[index] = { status: "fulfilled", value: await mapper(values[index]!) };
        } catch (reason) {
          results[index] = { status: "rejected", reason };
        }
      }
    },
  );
  await Promise.all(workers);
  return results;
}
