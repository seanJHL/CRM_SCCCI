/**
 * Gmail routes — thread retrieval, classification, reply generation,
 * reply sending (with user confirmation), and bulk management.
 */

import { Hono } from "hono";
import { z } from "zod";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import type { AppBindings } from "@/types";
import { createDatabase, type Database } from "@/db";
import {
  emailThreads,
  suggestedReplies,
  meetingRequests,
  type EmailThread,
} from "@/db/schema";
import { ApiError, ok } from "@/lib/utils";
import { getEnv } from "@/lib/env";
import {
  getValidAccessToken,
  GOOGLE_SCOPE,
} from "@/lib/google-oauth";
import { createCalendarBooking } from "@/lib/booking";
import {
  gmailListThreads,
  gmailGetThread,
  gmailSendReply,
  type GmailMessage,
  type GmailThreadDetail,
} from "@/lib/google-api";
import { classifyEmail } from "@/lib/email-classifier";
import { generateReply } from "@/lib/reply-generator";
import {
  generateOpenRouterReply,
  OPENROUTER_REPLY_MODEL,
} from "@/lib/openrouter";
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
  draftId: z.string().uuid().optional(),
});

const replySendSchema = z.object({
  body: z.string().trim().min(1, "Reply body is required").max(100_000),
  to: z.string().email().optional(),
  draftId: z.string().uuid().optional(),
  confirmed: z.literal(true),
});

const replySaveSchema = z.object({
  body: z.string().trim().min(1, "Draft body is required").max(100_000),
  draftId: z.string().uuid().optional(),
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

const sendMessageMeetingSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    start: z.string().datetime(),
    end: z.string().datetime(),
    attendees: z.array(z.object({ email: z.string().email() })).max(50).optional(),
    description: z.string().max(5000).optional(),
    location: z.string().max(500).optional(),
    addMeetLink: z.boolean().optional(),
    allowOutsideWorkingHours: z.boolean().optional(),
  })
  .refine((value) => new Date(value.end) > new Date(value.start), {
    message: "End time must be after start time",
    path: ["end"],
  });

const sendMessageSchema = z.object({
  to: z.string().email(),
  subject: z.string().trim().min(1).max(500),
  body: z.string().trim().min(1).max(100_000),
  confirmed: z.literal(true),
  meeting: sendMessageMeetingSchema.optional(),
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
    threads.push(
      await cacheAndClassifyThread(db, userId, c.get("user").timezone, result.value),
    );
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

// --- POST /send — compose and send a brand-new message, optionally booking a meeting ---

gmailRoute.post("/send", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const userId = c.get("userId");
  const user = c.get("user");
  const { to, subject, body, meeting } = sendMessageSchema.parse(
    await c.req.json(),
  );

  const accessToken = await getValidAccessToken(db, env, userId, [
    GOOGLE_SCOPE.GMAIL_READ,
    GOOGLE_SCOPE.GMAIL_SEND,
  ]);

  // The send itself is irreversible and has no idempotency protection for
  // brand-new messages, so once it succeeds nothing after it may turn into
  // an error response — a user who sees "failed" here and retries could
  // send a genuine duplicate email.
  const sendResult = await gmailSendReply(accessToken, { to, subject, body });

  let cachedThread: EmailThread | null = null;
  try {
    const detail = await gmailGetThread(accessToken, sendResult.threadId);
    cachedThread = await cacheAndClassifyThread(
      db,
      userId,
      user.timezone,
      detail,
    );

    await logAction(db, userId, AuditAction.EMAIL_SEND, "email_thread", cachedThread.id, {
      threadId: sendResult.threadId,
      to,
      messageId: sendResult.id,
    });
  } catch (error) {
    // Best-effort: the email already sent successfully, so a failure here
    // (a second Gmail read, a DB write, or the audit log) must not fail the
    // request. Log server-side since this is otherwise invisible — it never
    // reaches the global error handler.
    console.error(
      JSON.stringify({
        level: "error",
        type: "gmail_send_post_process_failed",
        userId,
        threadId: sendResult.threadId,
        code: error instanceof ApiError ? error.code : "UNKNOWN",
      }),
    );
  }

  let booking: Awaited<ReturnType<typeof createCalendarBooking>>["booking"] | null = null;
  let bookingError: string | undefined;
  if (meeting && !cachedThread) {
    // createCalendarBooking needs sourceThreadId to be a cached
    // emailThreads.id, which doesn't exist because caching above failed.
    // The email still sent successfully; only the booking is deferred.
    bookingError =
      "The message was sent, but the conversation could not be synced yet, so no calendar event was created. It will appear after the next Gmail sync — try booking from there.";
  } else if (meeting && cachedThread) {
    try {
      const created = await createCalendarBooking(db, env, userId, user, {
        ...meeting,
        sourceThreadId: cachedThread.id,
      });
      booking = created.booking;
    } catch (error) {
      // The email is not reversible — a booking failure (e.g. a conflict
      // that appeared between slot suggestion and confirmation) must not
      // be reported as if the whole action failed. Log server-side since
      // this is otherwise invisible — it never reaches the global error
      // handler.
      console.error(
        JSON.stringify({
          level: "error",
          type: "booking_after_send_failed",
          userId,
          threadId: cachedThread.id,
          code: error instanceof ApiError ? error.code : "UNKNOWN",
        }),
      );
      bookingError =
        error instanceof ApiError
          ? error.message
          : "The calendar event could not be created.";
    }
  }

  return c.json(
    ok({
      sent: true,
      messageId: sendResult.id,
      threadId: cachedThread ? cachedThread.gmailThreadId : sendResult.threadId,
      booking,
      bookingError,
    }),
  );
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

  // Fetch full thread from Gmail. Idempotent reads are retried by the Google
  // client; if Gmail still has a transient problem, keep the cached metadata
  // usable instead of forcing the user to manually resynchronise.
  let detail;
  let stale = false;
  try {
    const accessToken = await getValidAccessToken(db, env, userId, [
      GOOGLE_SCOPE.GMAIL_READ,
    ]);
    detail = await gmailGetThread(accessToken, threadId);
  } catch (error) {
    if (!cached || isGoogleActionRequired(error)) throw error;
    detail = cachedThreadDetail(cached);
    stale = true;
    console.warn(
      JSON.stringify({
        level: "warn",
        type: "gmail_thread_cache_fallback",
        threadId,
        code: error instanceof ApiError ? error.code : "UNKNOWN",
      }),
    );
  }

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
      stale,
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
  const threadId = c.req.param("threadId");
  const { regenerate, currentBody, draftId } = replyGenerateSchema.parse(await c.req.json().catch(() => ({})));

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
  const replyBody = await generateOpenRouterReply({
    apiKey: env.openRouterApiKey,
    subject: cached.subject ?? detail.subject ?? "",
    messages: detail.messages,
    currentBody: regenerate ? currentBody : undefined,
  });

  const existingDraft = draftId
    ? (
        await db
          .select()
          .from(suggestedReplies)
          .where(
            and(
              eq(suggestedReplies.id, draftId),
              eq(suggestedReplies.threadId, cached.id),
              eq(suggestedReplies.userId, userId),
            ),
          )
          .limit(1)
      )[0]
    : undefined;
  const [draft] = existingDraft && existingDraft.status !== "sent"
    ? await db
        .update(suggestedReplies)
        .set({ body: replyBody, status: "draft", approvedAt: null })
        .where(eq(suggestedReplies.id, existingDraft.id))
        .returning()
    : await db
        .insert(suggestedReplies)
        .values({
          threadId: cached.id,
          userId,
          body: replyBody,
          status: "draft",
        })
        .returning();

  await logAction(db, userId, AuditAction.EMAIL_REPLY_SUGGEST, "suggested_reply", draft.id, {
    threadId,
    model: OPENROUTER_REPLY_MODEL,
  });

  return c.json(ok({ reply: draft, model: OPENROUTER_REPLY_MODEL }));
});

// --- POST /:threadId/draft — save an editable draft without sending ---

gmailRoute.post("/:threadId/draft", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const userId = c.get("userId");
  const threadId = c.req.param("threadId");
  const { body, draftId } = replySaveSchema.parse(await c.req.json());

  const [cached] = await db
    .select({ id: emailThreads.id })
    .from(emailThreads)
    .where(
      and(
        eq(emailThreads.userId, userId),
        eq(emailThreads.gmailThreadId, threadId),
      ),
    );
  if (!cached) throw ApiError.notFound("Thread not found in cache");

  let existing = draftId
    ? (
        await db
          .select()
          .from(suggestedReplies)
          .where(
            and(
              eq(suggestedReplies.id, draftId),
              eq(suggestedReplies.threadId, cached.id),
              eq(suggestedReplies.userId, userId),
            ),
          )
          .limit(1)
      )[0]
    : undefined;

  if (!existing && !draftId) {
    existing = (
      await db
        .select()
        .from(suggestedReplies)
        .where(
          and(
            eq(suggestedReplies.threadId, cached.id),
            eq(suggestedReplies.userId, userId),
            eq(suggestedReplies.status, "draft"),
          ),
        )
        .orderBy(desc(suggestedReplies.createdAt))
        .limit(1)
    )[0];
  }

  if (draftId && !existing) throw ApiError.notFound("Draft not found");
  if (existing?.status === "sent") {
    throw ApiError.conflict("A sent reply cannot be changed");
  }

  const [draft] = existing
    ? await db
        .update(suggestedReplies)
        .set({ body, status: "draft", approvedAt: null })
        .where(eq(suggestedReplies.id, existing.id))
        .returning()
    : await db
        .insert(suggestedReplies)
        .values({ threadId: cached.id, userId, body, status: "draft" })
        .returning();

  return c.json(ok({ reply: draft }));
});

// --- DELETE /:threadId/draft/:draftId — discard an unsent draft ---

gmailRoute.delete("/:threadId/draft/:draftId", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const userId = c.get("userId");
  const threadId = c.req.param("threadId");
  const draftId = z.string().uuid().parse(c.req.param("draftId"));

  const [cached] = await db
    .select({ id: emailThreads.id })
    .from(emailThreads)
    .where(
      and(
        eq(emailThreads.userId, userId),
        eq(emailThreads.gmailThreadId, threadId),
      ),
    );
  if (!cached) throw ApiError.notFound("Thread not found in cache");

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
  if (!draft) throw ApiError.notFound("Draft not found");
  if (draft.status === "sent") throw ApiError.conflict("A sent reply cannot be discarded");

  await db.delete(suggestedReplies).where(eq(suggestedReplies.id, draft.id));
  return c.json(ok({ discarded: true }));
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

/**
 * Classify a Gmail thread and upsert it into the emailThreads cache,
 * recording a detected meeting request if one is present. Used both when
 * syncing the inbox and right after sending a brand-new message.
 */
async function cacheAndClassifyThread(
  db: Database,
  userId: string,
  timezone: string,
  detail: GmailThreadDetail,
): Promise<EmailThread> {
  const lastIncoming = [...detail.messages]
    .reverse()
    .find((message) => !message.labelIds.includes("SENT"));
  const classificationText = detail.messages
    .slice(-4)
    .map((message) => message.bodyText || message.snippet)
    .join("\n\n")
    .slice(0, 20_000);

  const classification = classifyEmail(
    detail.subject,
    lastIncoming?.fromEmail ?? detail.fromEmail,
    classificationText || detail.snippet,
  );
  const latestIsIncoming = !detail.lastMessage.labelIds.includes("SENT");
  const requiresResponse = latestIsIncoming && classification.requiresResponse;

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

  let thread: EmailThread;
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
    thread = updated!;
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
    thread = created!;
  }

  if (classification.hasMeetingRequest) {
    await db
      .insert(meetingRequests)
      .values({
        userId,
        threadId: thread.id,
        rawText: `${detail.subject} ${lastIncoming?.snippet ?? detail.snippet}`.slice(0, 2_000),
        timezone,
        status: "detected",
      })
      .onConflictDoNothing();
  }

  return thread;
}

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

function isGoogleActionRequired(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    ["GOOGLE_REAUTH_REQUIRED", "GOOGLE_PERMISSION_REQUIRED"].includes(error.code)
  );
}

function cachedThreadDetail(
  cached: typeof emailThreads.$inferSelect,
): Awaited<ReturnType<typeof gmailGetThread>> {
  const timestamp = cached.lastMessageDate ?? cached.updatedAt;
  const internalDate = String(timestamp.getTime());
  const message: GmailMessage = {
    id: `cached-${cached.gmailThreadId}`,
    threadId: cached.gmailThreadId,
    snippet: cached.snippet ?? "",
    labelIds: cached.hasUnread ? ["INBOX", "UNREAD"] : ["INBOX"],
    headers: [],
    bodyText: cached.snippet ?? "",
    from: cached.fromEmail ?? "",
    fromName: cached.fromName ?? "",
    fromEmail: cached.fromEmail ?? "",
    to: "",
    subject: cached.subject ?? "",
    date: timestamp.toISOString(),
    messageId: "",
    inReplyTo: null,
    references: null,
    internalDate,
  };
  return {
    id: cached.gmailThreadId,
    messages: [message],
    lastMessage: message,
    subject: cached.subject ?? "",
    from: cached.fromEmail ?? "",
    fromName: cached.fromName ?? "",
    fromEmail: cached.fromEmail ?? "",
    snippet: cached.snippet ?? "",
    lastMessageDate: timestamp,
    hasUnread: cached.hasUnread,
  };
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
