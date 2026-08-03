# Compose button with integrated scheduling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Compose button to `/crm` that lets the user send a brand-new
email to any recipient, with the same natural-language meeting detection,
conflict-checking, and calendar-booking behavior the existing reply flow
has — with the calendar event created automatically right after a
successful send.

**Architecture:** Reuse the existing NL-scheduling engine (`scheduler.ts`)
and duplicate-prevention logic unchanged. Extract two pieces of currently
inline route logic into shared helpers (`createCalendarBooking`,
`cacheAndClassifyThread`) so a new `POST /api/gmail/send` endpoint can
reuse them alongside the existing reply/booking endpoints. On the frontend,
extract the current "Create draft" dialog into its own `ComposerDialog`
component, then add a `mode: "new"` branch to it for the compose flow, and
wire up a Compose button.

**Tech Stack:** Hono + Zod + Drizzle (Postgres/Neon) on Cloudflare Workers
for the API; React + TanStack Query/Router on Vite for the web app; Vitest
for backend tests (no frontend test runner is configured in this repo —
frontend verification is manual, via the dev server).

## Global Constraints

- No email is ever sent, and no calendar event is ever created, without an
  explicit user confirmation step (existing project-wide rule — see the
  file header comments in `calendar-crm.ts` and `gmail.ts`).
- Duplicate calendar events must never be created — reuse the existing
  three-layer prevention (DB overlap check, live Google re-check, unique
  DB constraint) via the shared `createCalendarBooking` helper; do not
  reimplement it.
- Reply-mode behavior in the composer must not change (byte-for-byte)
  after Task 5's extraction — it is a pure refactor.
- Follow existing project conventions: Zod schemas for request validation,
  `ApiError`/`ok()` response helpers, `logAction`/`AuditAction` for audit
  logging, TanStack Query `useMutation`/`useQuery` on the frontend.
- This repo has no automated tests for DB-backed Hono routes (only pure
  functions are unit tested with Vitest, using `vi.stubGlobal("fetch", …)`
  for Google API mocking) and no frontend test runner at all (`apps/web`'s
  `test` script is a no-op). Follow this existing convention: write Vitest
  tests only for new/changed pure functions; verify DB-backed routes and
  all frontend work by running the dev servers and exercising the feature
  in a browser.

---

## Task 1: `gmailSendReply` returns the created thread id

**Files:**
- Modify: `apps/api/src/lib/google-api.ts:216-267` (the `gmailSendReply` function)
- Test: `apps/api/test/crm.test.ts`

**Interfaces:**
- Produces: `GmailSendResult` (`{ id: string; threadId: string }`), the new
  return type of `gmailSendReply(accessToken, { to, subject, body,
  threadId?, inReplyTo?, references? })`. Task 4 calls this without
  `threadId` to send a brand-new message and reads `result.threadId` to
  find the thread Gmail created for it.

`gmailSendReply` already sends correctly with no `threadId` (Gmail simply
starts a new thread), and Gmail's `users.messages.send` response already
includes `threadId` in its JSON body — only the TypeScript return type
needs widening so callers can read it.

- [ ] **Step 1: Write the failing test**

Add this test to `apps/api/test/crm.test.ts`, in a new `describe` block
placed after the existing `describe("email intelligence", ...)` block:

```ts
describe("gmail send", () => {
  it("sends a brand-new message without threading headers and returns the created thread id", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body)) as { raw: string; threadId?: string };
      expect(payload.threadId).toBeUndefined();
      const decoded = Buffer.from(
        payload.raw.replace(/-/g, "+").replace(/_/g, "/"),
        "base64",
      ).toString("utf-8");
      expect(decoded).not.toContain("In-Reply-To:");
      expect(decoded).not.toContain("References:");
      expect(decoded).toContain("To: alex@example.com");
      expect(decoded).toContain("Subject: Project kickoff");
      return Response.json({ id: "message-new-1", threadId: "thread-new-1", labelIds: ["SENT"] });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await gmailSendReply("access-token", {
      to: "alex@example.com",
      subject: "Project kickoff",
      body: "Let's have a call this Tuesday at 12:00 PM.",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result).toEqual(
      expect.objectContaining({ id: "message-new-1", threadId: "thread-new-1" }),
    );
  });
});
```

Update the import at the top of the file to also bring in `gmailSendReply`:

```ts
import { gmailGetThread, gmailSendReply } from "../src/lib/google-api";
```

(This replaces the current line `import { gmailGetThread } from "../src/lib/google-api";`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm test -- -t "sends a brand-new message"`
Expected: FAIL — `result` is typed `Promise<{ id: string }>`, so
`result.threadId` doesn't type-check yet (or, if TS isn't checked by
Vitest directly, the `toEqual(expect.objectContaining(...))` assertion
still passes since JS is untyped at runtime — the meaningful failure here
is `pnpm typecheck`, see Step 3). Confirm the test runs and the mock
assertions inside it pass; then run `pnpm typecheck` and confirm it fails
because `GmailSendResult` doesn't exist yet.

Run: `pnpm --filter api typecheck`
Expected: FAIL — no `GmailSendResult` type, `threadId` not assignable.

- [ ] **Step 3: Widen the return type**

In `apps/api/src/lib/google-api.ts`, add a new exported interface right
above `gmailSendReply` and change the function's return type:

```ts
export interface GmailSendResult {
  id: string;
  threadId: string;
}

/**
 * Send a reply email via Gmail.
 * Builds an RFC 2822 message with threading headers.
 */
export async function gmailSendReply(
  accessToken: string,
  params: {
    to: string;
    subject: string;
    body: string;
    threadId?: string;
    inReplyTo?: string | null;
    references?: string | null;
  },
): Promise<GmailSendResult> {
```

(Only the return type annotation changes — `Promise<{ id: string }>`
becomes `Promise<GmailSendResult>`. The function body is unchanged.)

- [ ] **Step 4: Run test and typecheck to verify they pass**

Run: `cd apps/api && pnpm test -- -t "sends a brand-new message"`
Expected: PASS

Run: `pnpm --filter api typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/google-api.ts apps/api/test/crm.test.ts
git commit -m "feat(api): return the created thread id from gmailSendReply"
```

---

## Task 2: Extract `createCalendarBooking` shared helper

**Files:**
- Create: `apps/api/src/lib/booking.ts`
- Modify: `apps/api/src/routes/calendar-crm.ts` (the `POST /events` handler and its imports)

**Interfaces:**
- Consumes: `Database` (`@/db`), `EnvConfig` (`@/lib/env`), `ApiError`
  (`@/lib/utils`), `getValidAccessToken`/`GOOGLE_SCOPE` (`@/lib/google-oauth`),
  `calendarCreateEvent` (`@/lib/google-api`), `checkAvailability`
  (`@/lib/scheduler`), `logAction`/`AuditAction` (`@/lib/audit`),
  `syncCrmBookingsToEmberCalendar` (`@/lib/calendar-sync`), and the
  `calendarBookings`/`emailThreads`/`meetingRequests` tables (`@/db/schema`).
- Produces: `createCalendarBooking(db, env, userId, user, input):
  Promise<CreateBookingResult>` — `CreateBookingResult = { booking:
  CalendarBooking; googleEventId: string; htmlLink: string }`. Throws
  `ApiError.badRequest` (unknown `sourceThreadId`) or `ApiError.conflict`
  (overlapping booking, or the requested time is no longer available).
  Task 4 calls this directly from the new send endpoint.

This is a **behavior-preserving extraction**: the code below is the exact
logic currently inline in `calendar-crm.ts`'s `POST /events` handler
(everything after `createEventSchema.parse(...)`), moved verbatim into a
reusable function. There is no automated test for this task — it's
DB/Google-API-dependent route logic, and this repo has no DB test harness
for any route (see Global Constraints). Verification is `pnpm typecheck`
plus the manual regression check in Step 3 (the existing reply-flow
booking dialog, which now runs through this exact code path).

- [ ] **Step 1: Create `apps/api/src/lib/booking.ts`**

```ts
/**
 * Shared calendar-booking creation, used by both the reply-flow booking
 * endpoint and the compose-and-send flow. No event is created without a
 * caller-verified confirmation upstream of this function.
 */

import { and, eq, sql } from "drizzle-orm";
import type { Database } from "@/db";
import {
  calendarBookings,
  emailThreads,
  meetingRequests,
  type CalendarBooking,
} from "@/db/schema";
import type { EnvConfig } from "@/lib/env";
import { ApiError } from "@/lib/utils";
import { getValidAccessToken, GOOGLE_SCOPE } from "@/lib/google-oauth";
import { calendarCreateEvent } from "@/lib/google-api";
import { checkAvailability } from "@/lib/scheduler";
import { logAction, AuditAction } from "@/lib/audit";
import { syncCrmBookingsToEmberCalendar } from "@/lib/calendar-sync";

export interface CreateBookingInput {
  title: string;
  start: string;
  end: string;
  attendees?: { email: string }[];
  description?: string;
  location?: string;
  addMeetLink?: boolean;
  sourceThreadId?: string;
  allowOutsideWorkingHours?: boolean;
}

export interface BookingUserProfile {
  timezone: string;
  workingHoursStart: string;
  workingHoursEnd: string;
}

export interface CreateBookingResult {
  booking: CalendarBooking;
  googleEventId: string;
  htmlLink: string;
}

export async function createCalendarBooking(
  db: Database,
  env: EnvConfig,
  userId: string,
  user: BookingUserProfile,
  input: CreateBookingInput,
): Promise<CreateBookingResult> {
  const start = new Date(input.start);
  const end = new Date(input.end);

  let sourceContext: { subject: string | null; snippet: string | null } | null = null;
  if (input.sourceThreadId) {
    const [sourceThread] = await db
      .select({
        id: emailThreads.id,
        subject: emailThreads.subject,
        snippet: emailThreads.snippet,
      })
      .from(emailThreads)
      .where(
        and(
          eq(emailThreads.id, input.sourceThreadId),
          eq(emailThreads.userId, userId),
        ),
      );
    if (!sourceThread) {
      throw ApiError.badRequest("The source email thread was not found");
    }
    sourceContext = sourceThread;
  }

  // Duplicate prevention, layer 1: reject if a confirmed CRM booking
  // already overlaps this time range.
  const existing = await db
    .select()
    .from(calendarBookings)
    .where(
      and(
        eq(calendarBookings.userId, userId),
        eq(calendarBookings.status, "confirmed"),
        sql`${calendarBookings.startAt} < ${end.toISOString()}`,
        sql`${calendarBookings.endAt} > ${start.toISOString()}`,
      ),
    );

  if (existing.length > 0) {
    throw ApiError.conflict("A confirmed CRM booking overlaps this time", {
      existingBooking: existing[0],
    });
  }

  // Duplicate prevention, layer 2: re-check Google immediately before
  // creation to close the race between slot recommendation and
  // confirmation.
  const accessToken = await getValidAccessToken(db, env, userId, [
    GOOGLE_SCOPE.CALENDAR_EVENTS,
    GOOGLE_SCOPE.CALENDAR_AVAILABILITY,
  ]);
  const availability = await checkAvailability(
    accessToken,
    input.start,
    input.end,
    user.timezone,
    {
      start: user.workingHoursStart,
      end: user.workingHoursEnd,
    },
    input.attendees?.map((attendee) => attendee.email),
  );
  if (!availability.available) {
    const outsideHoursOnly =
      availability.conflicts.length === 0 && !availability.withinWorkingHours;
    if (!(outsideHoursOnly && input.allowOutsideWorkingHours)) {
      throw ApiError.conflict(
        `The selected time is no longer available: ${availability.reason}`,
        availability,
      );
    }
  }

  const description =
    input.description ??
    (sourceContext
      ? `Scheduled from Gmail thread: ${sourceContext.subject ?? "Untitled conversation"}\n\nEmail context: ${sourceContext.snippet ?? ""}`
      : undefined);
  const result = await calendarCreateEvent(accessToken, {
    summary: input.title,
    description,
    location: input.location,
    start: input.start,
    end: input.end,
    attendees: input.attendees,
    addMeetLink: input.addMeetLink,
    sourceThreadId: input.sourceThreadId,
  });

  const [booking] = await db
    .insert(calendarBookings)
    .values({
      userId,
      googleEventId: result.id,
      title: input.title,
      description: description ?? null,
      startAt: start,
      endAt: end,
      attendees: input.attendees ?? null,
      meetLink: result.hangoutLink,
      location: input.location ?? null,
      sourceThreadId: input.sourceThreadId ?? null,
      status: "confirmed",
    })
    .returning();

  // Idempotent upsert into the canonical Ember Calendar table, keyed by
  // this booking's id — repeated syncs never duplicate the event there.
  await syncCrmBookingsToEmberCalendar(db, userId);

  if (input.sourceThreadId) {
    await db
      .update(emailThreads)
      .set({ status: "scheduled", updatedAt: new Date() })
      .where(
        and(
          eq(emailThreads.id, input.sourceThreadId),
          eq(emailThreads.userId, userId),
        ),
      );
    await db
      .update(meetingRequests)
      .set({
        status: "booked",
        parsedStart: start,
        parsedEnd: end,
      })
      .where(
        and(
          eq(meetingRequests.threadId, input.sourceThreadId),
          eq(meetingRequests.userId, userId),
        ),
      );
  }

  await logAction(db, userId, AuditAction.CALENDAR_CREATE, "calendar_booking", booking!.id, {
    title: input.title,
    start: input.start,
    end: input.end,
    googleEventId: result.id,
    meetLink: result.hangoutLink,
  });

  return { booking: booking!, googleEventId: result.id, htmlLink: result.htmlLink };
}
```

- [ ] **Step 2: Refactor `POST /events` in `calendar-crm.ts` to delegate**

Replace the entire handler body (from `calendarCrmRoute.post("/events", ...)`
through its closing `});`, currently lines 209-358) with:

```ts
calendarCrmRoute.post("/events", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const userId = c.get("userId");
  const input = createEventSchema.parse(await c.req.json());

  const result = await createCalendarBooking(db, env, userId, c.get("user"), input);

  return c.json(ok(result));
});
```

Update the imports at the top of `calendar-crm.ts`:

- Remove `calendarCreateEvent` from the `@/lib/google-api` import (keep
  `calendarListEvents, calendarUpdateEvent, calendarDeleteEvent` — they're
  still used by the other routes in this file).
- Remove `emailThreads, meetingRequests` from the `@/db/schema` import
  (keep `calendarBookings` — it's still used elsewhere in this file).
- Add: `import { createCalendarBooking } from "@/lib/booking";`

Leave `sql`, `ne`, `and`, `eq` (from `drizzle-orm`) and
`checkAvailability` (from `@/lib/scheduler`) imported exactly as they are
— both are still used by the `PATCH /events/:id` and
`POST /check-availability` handlers in this same file.

- [ ] **Step 3: Verify with typecheck, the existing test suite, and a manual regression check**

Run: `pnpm --filter api typecheck`
Expected: PASS

Run: `pnpm --filter api test`
Expected: PASS (unrelated to this change, but confirms nothing else broke)

Manual regression check (this route has no automated test in this repo):
start the dev servers (`pnpm --filter api dev` and `pnpm --filter web dev`
in separate terminals), sign in, open a Gmail thread containing a
proposed time (e.g. "Let's talk Tuesday at 2pm"), click **Create Draft**,
confirm a suggested slot, and click **Create Calendar event**. Confirm the
event appears both in the response and on the main **Calendar** page, and
that repeating the same booking is rejected as a conflict (duplicate
prevention still works).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/lib/booking.ts apps/api/src/routes/calendar-crm.ts
git commit -m "refactor(api): extract createCalendarBooking into a shared helper"
```

---

## Task 3: Extract `cacheAndClassifyThread` shared helper

**Files:**
- Modify: `apps/api/src/routes/gmail.ts` (the `GET /` handler and its imports; adds a new private helper function)

**Interfaces:**
- Consumes: `classifyEmail` (`@/lib/email-classifier`), the
  `emailThreads`/`meetingRequests` tables and `EmailThread` type
  (`@/db/schema`), `GmailThreadDetail` type (`@/lib/google-api`).
- Produces: `cacheAndClassifyThread(db, userId, timezone, detail):
  Promise<EmailThread>` (module-private to `gmail.ts`, not exported —
  only used within this file). Task 4 calls this after sending a new
  message, so the sent thread is classified and appears in the inbox like
  any synced thread.

Behavior-preserving extraction, same rationale and verification approach
as Task 2 — no automated test; this is a refactor of already-in-production
route logic. `GET /api/gmail` must behave identically afterward.

- [ ] **Step 1: Add the helper function to `gmail.ts`**

Add this function near the bottom of `apps/api/src/routes/gmail.ts`,
alongside the other private helpers (`parseImportanceReasons`,
`isGoogleActionRequired`, etc.):

```ts
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
```

- [ ] **Step 2: Replace the `GET /` handler's inline loop with a call to the helper**

In the `gmailRoute.get("/", ...)` handler, replace the `for` loop and
everything inside it (currently building up `threads` by hand — from
`const threads = [];` through the closing `}` of the loop) with:

```ts
  const threads = [];
  for (const result of threadDetails) {
    if (result.status !== "fulfilled") continue;
    threads.push(
      await cacheAndClassifyThread(db, userId, c.get("user").timezone, result.value),
    );
  }
```

- [ ] **Step 3: Update imports**

At the top of `gmail.ts`:

- Change `import { createDatabase } from "@/db";` to
  `import { createDatabase, type Database } from "@/db";`
- Change the schema import to also bring in the `EmailThread` type:
  `import { emailThreads, suggestedReplies, meetingRequests, type EmailThread } from "@/db/schema";`
- Change the google-api import to also bring in `GmailThreadDetail`:
  `import { gmailListThreads, gmailGetThread, gmailSendReply, type GmailMessage, type GmailThreadDetail } from "@/lib/google-api";`

- [ ] **Step 4: Verify with typecheck, the existing test suite, and a manual regression check**

Run: `pnpm --filter api typecheck`
Expected: PASS

Run: `pnpm --filter api test`
Expected: PASS

Manual regression check: start the dev servers, sign in, open `/crm`, and
click the Gmail sync/refresh button. Confirm threads still load, are
still classified (category/priority badges present), and that a thread
containing scheduling language ("let's meet Tuesday") still shows up
correctly (no missing threads, no console errors).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/gmail.ts
git commit -m "refactor(api): extract cacheAndClassifyThread into a shared helper"
```

---

## Task 4: `POST /api/gmail/send` — compose and send a new message

**Files:**
- Modify: `apps/api/src/routes/gmail.ts` (new schema + new route handler + imports)

**Interfaces:**
- Consumes: `createCalendarBooking` (Task 2, `@/lib/booking`),
  `cacheAndClassifyThread` (Task 3, private to this file), `gmailSendReply`
  returning `GmailSendResult` (Task 1).
- Produces: `POST /api/gmail/send` — request `{ to, subject, body,
  confirmed: true, meeting?: {...} }`, response `{ sent: true, messageId,
  threadId, booking: CalendarBooking | null, bookingError?: string }`.
  Task 6 (frontend) calls this endpoint.

No automated test for this route (DB + Google API dependent — see Global
Constraints); it's exercised end-to-end by the manual browser test in
Task 6, which is the realistic way to verify a full send-and-book flow
against a real Google account. The request-schema shape itself follows
the exact same Zod pattern as every other schema already in this file
(e.g. `createEventSchema` in `calendar-crm.ts`), which this repo does not
unit-test in isolation either.

- [ ] **Step 1: Add the request schema**

Add this near the top of `apps/api/src/routes/gmail.ts`, alongside the
other `z.object(...)` schemas:

```ts
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
```

- [ ] **Step 2: Add the route handler**

Add this immediately after the closing `});` of the `GET /` handler (i.e.
before `// --- GET /:threadId — full thread detail ---`), so collection-
level actions are grouped together:

```ts
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

  const sendResult = await gmailSendReply(accessToken, { to, subject, body });
  const detail = await gmailGetThread(accessToken, sendResult.threadId);
  const cachedThread = await cacheAndClassifyThread(
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

  let booking: Awaited<ReturnType<typeof createCalendarBooking>>["booking"] | null = null;
  let bookingError: string | undefined;
  if (meeting) {
    try {
      const created = await createCalendarBooking(db, env, userId, user, {
        ...meeting,
        sourceThreadId: cachedThread.id,
      });
      booking = created.booking;
    } catch (error) {
      // The email is not reversible — a booking failure (e.g. a conflict
      // that appeared between slot suggestion and confirmation) must not
      // be reported as if the whole action failed.
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
      threadId: cachedThread.gmailThreadId,
      booking,
      bookingError,
    }),
  );
});
```

- [ ] **Step 3: Update imports**

At the top of `gmail.ts`, add:

```ts
import { createCalendarBooking } from "@/lib/booking";
```

`ApiError` and `ok` are already imported from `@/lib/utils` in this file;
`getValidAccessToken` and `GOOGLE_SCOPE` are already imported from
`@/lib/google-oauth`. No further import changes are needed.

- [ ] **Step 4: Verify with typecheck and a manual smoke test**

Run: `pnpm --filter api typecheck`
Expected: PASS

Manual smoke test (start `pnpm --filter api dev`, sign in via the web app
first so you have a valid session cookie, then from the browser devtools
console on the running web app — which shares the API's CORS/cookie
origin — run):

```js
await fetch("http://localhost:8788/api/gmail/send", {
  method: "POST",
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    to: "<an email address you can check>",
    subject: "Compose endpoint smoke test",
    body: "Testing the new compose endpoint. Let's talk this Tuesday at 3pm.",
    confirmed: true,
  }),
}).then((r) => r.json());
```

Expected: `{ success: true, data: { sent: true, messageId: "...",
threadId: "...", booking: null, bookingError: undefined } }`. Confirm the
message actually arrived at the recipient, and that a new thread shows up
in `/crm`'s inbox after a refresh. This will also be exercised through the
UI end-to-end in Task 6.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/gmail.ts
git commit -m "feat(api): add POST /api/gmail/send to compose and send new messages"
```

---

## Task 5: Extract `ComposerDialog` (reply mode only — pure refactor)

**Files:**
- Create: `apps/web/src/components/ui/field.tsx`
- Create: `apps/web/src/components/crm/composer-dialog.tsx`
- Modify: `apps/web/src/lib/crm.ts` (add `errorMessage`)
- Modify: `apps/web/src/routes/crm.tsx`

**Interfaces:**
- Consumes: `Field` (new, `@/components/ui/field`), `errorMessage` (new,
  `@/lib/crm`), plus `EmailThread`, `ThreadDetailData`, `SessionData`,
  `ParsedSchedule`, `AvailabilityResult`, `SuggestedSlot`, `SuggestedReply`
  types and `api`/`ApiClientError` from existing `@/lib/*` modules.
- Produces: `<ComposerDialog mode="reply" open onOpenChange thread detail
  session invalidateInbox onNotice />` — a self-contained dialog
  component. `invalidateInbox: () => Promise<void>` and `onNotice:
  (message: string) => void` are callback props the parent already has
  (Step 5 below). Task 6 extends this component's props with a `mode:
  "new"` variant.

This task moves the "Create draft" dialog (currently ~250 lines of JSX
plus its state and mutations, inlined in `CrmDashboard`) into its own
component with **zero behavior change** for the reply flow. Two small
helpers it needs (`Field`, `errorMessage`) currently live as private
functions at the bottom of `crm.tsx`; since `crm.tsx` will also need to
import `ComposerDialog`, leaving them there would create a circular
import (`crm.tsx` → `composer-dialog.tsx` → `crm.tsx`). Both are generic
enough to promote to proper shared locations instead: `Field` (a plain
label+control wrapper, not CRM-specific) to `@/components/ui/field`
alongside the other UI primitives, and `errorMessage` (a one-line
`Error`-to-string formatter) to `@/lib/crm`, which both files already
depend on. There is no frontend test runner in this repo (see Global
Constraints) — verification is `pnpm typecheck` plus a manual regression
pass through the reply flow in a browser, since this is exactly the kind
of UI behavior that's only meaningfully checked by using it.

- [ ] **Step 1: Create `apps/web/src/components/ui/field.tsx`**

```tsx
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
```

- [ ] **Step 2: Add `errorMessage` to `apps/web/src/lib/crm.ts`**

Add near the bottom of the file, after the existing exported functions
(`loadSession`, `googleSignInUrl`):

```ts
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}
```

- [ ] **Step 3: Create `apps/web/src/components/crm/composer-dialog.tsx`**

```tsx
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  Loader2,
  RefreshCw,
  Save,
  Send,
  Sparkles,
  Trash2,
  Video,
} from "lucide-react";
import { api, ApiClientError } from "@/lib/api";
import {
  type AvailabilityResult,
  type EmailThread,
  errorMessage,
  type ParsedSchedule,
  type SessionData,
  type SuggestedReply,
  type SuggestedSlot,
  type ThreadDetailData,
} from "@/lib/crm";
import { queryKeys } from "@/lib/query-keys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";

interface ComposerDialogProps {
  mode: "reply";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  thread: EmailThread;
  detail: ThreadDetailData | undefined;
  session: SessionData;
  invalidateInbox: () => Promise<void>;
  onNotice: (message: string) => void;
}

export function ComposerDialog(props: ComposerDialogProps) {
  const queryClient = useQueryClient();
  const { thread, detail, session } = props;

  const [replyBody, setReplyBody] = useState("");
  const [replyDraftId, setReplyDraftId] = useState<string | null>(null);
  const [draftHydratedFor, setDraftHydratedFor] = useState<string | null>(null);
  const [sendConfirmationOpen, setSendConfirmationOpen] = useState(false);

  const [parsedSchedule, setParsedSchedule] = useState<ParsedSchedule | null>(null);
  const [availability, setAvailability] = useState<AvailabilityResult | null>(null);
  const [suggestedSlots, setSuggestedSlots] = useState<SuggestedSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<SuggestedSlot | null>(null);
  const [scheduleMessage, setScheduleMessage] = useState<string | null>(null);
  const [ambiguityConfirmed, setAmbiguityConfirmed] = useState(false);
  const [meetingTitle, setMeetingTitle] = useState("");
  const [meetingDescription, setMeetingDescription] = useState("");
  const [meetingLocation, setMeetingLocation] = useState("");
  const [attendeeText, setAttendeeText] = useState("");
  const [addMeetLink, setAddMeetLink] = useState(false);
  const [bookingConfirmationOpen, setBookingConfirmationOpen] = useState(false);

  const attendeeEmails = useMemo(
    () =>
      attendeeText
        .split(/[;,]/)
        .map((email) => email.trim())
        .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)),
    [attendeeText],
  );

  // Reset meeting/schedule fields to this thread's defaults every time the
  // dialog opens — matches the previous behavior of openComposerForThread.
  useEffect(() => {
    if (!props.open) return;
    setMeetingTitle(thread.subject ?? "Meeting");
    setMeetingDescription(
      `Scheduled from Gmail thread: ${thread.subject ?? "Untitled conversation"}\n\nEmail context: ${thread.snippet ?? ""}`,
    );
    setMeetingLocation("");
    setAttendeeText(thread.fromEmail ?? "");
    setAddMeetLink(false);
    setParsedSchedule(null);
    setAvailability(null);
    setSuggestedSlots([]);
    setSelectedSlot(null);
    setAmbiguityConfirmed(false);
    setScheduleMessage(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open, thread.id]);

  useEffect(() => {
    if (!detail || draftHydratedFor === thread.gmailThreadId) return;
    const latestDraft = detail.replies.find((reply) => reply.status !== "sent");
    setReplyBody(latestDraft?.body ?? "");
    setReplyDraftId(latestDraft?.id ?? null);
    setDraftHydratedFor(thread.gmailThreadId);
  }, [detail, draftHydratedFor, thread.gmailThreadId]);

  const generateReplyMutation = useMutation({
    mutationFn: (regenerate: boolean) =>
      api.post<{ reply: SuggestedReply }>(`/api/gmail/${thread.gmailThreadId}/reply`, {
        regenerate,
        currentBody: replyBody,
        draftId: replyDraftId ?? undefined,
      }),
    onSuccess: (data) => {
      setReplyBody(data.reply.body);
      setReplyDraftId(data.reply.id);
      props.onNotice("A reviewable draft was generated. Nothing has been sent.");
    },
  });
  const saveDraftMutation = useMutation({
    mutationFn: () =>
      api.post<{ reply: SuggestedReply }>(`/api/gmail/${thread.gmailThreadId}/draft`, {
        body: replyBody,
        draftId: replyDraftId ?? undefined,
      }),
    onSuccess: async (data) => {
      setReplyDraftId(data.reply.id);
      props.onNotice("Draft saved. Nothing has been sent.");
      await queryClient.invalidateQueries({
        queryKey: ["crm", "thread", thread.gmailThreadId],
      });
    },
  });
  const discardDraftMutation = useMutation({
    mutationFn: async () => {
      if (!replyDraftId) return { discarded: true };
      return api.delete<{ discarded: boolean }>(
        `/api/gmail/${thread.gmailThreadId}/draft/${replyDraftId}`,
      );
    },
    onSuccess: async () => {
      setReplyBody("");
      setReplyDraftId(null);
      props.onOpenChange(false);
      props.onNotice("Draft discarded.");
      await queryClient.invalidateQueries({
        queryKey: ["crm", "thread", thread.gmailThreadId],
      });
    },
  });
  const sendReplyMutation = useMutation({
    mutationFn: () =>
      api.post(`/api/gmail/${thread.gmailThreadId}/reply/send`, {
        body: replyBody,
        to: thread.fromEmail ?? undefined,
        draftId: replyDraftId ?? undefined,
        confirmed: true,
      }),
    onSuccess: async () => {
      setSendConfirmationOpen(false);
      props.onOpenChange(false);
      setReplyBody("");
      setReplyDraftId(null);
      props.onNotice("Reply sent through Gmail.");
      await props.invalidateInbox();
    },
  });

  const schedulingContext = useMemo(() => {
    const messages =
      [...(detail?.thread.messages ?? [])]
        .reverse()
        .slice(0, 6)
        .map((message) => message.bodyText || message.snippet)
        .join("\n\n") ||
      thread.snippet ||
      "";
    return `Draft reply:\n${replyBody}\n\nMost recent conversation first:\n${messages}`.slice(
      0,
      50_000,
    );
  }, [detail, replyBody, thread.snippet]);

  const parseScheduleMutation = useMutation({
    mutationFn: async (input: { text: string; participantEmails: string[] }) => {
      const parsed = await api.post<{
        detected: boolean;
        parsed: ParsedSchedule | null;
        message?: string;
      }>("/api/calendar-crm/parse-schedule", { text: input.text.slice(0, 50_000) });
      if (!parsed.parsed) return { parsed, availability: null, slots: [] };
      const [checked, slots] = await Promise.all([
        api.post<AvailabilityResult>("/api/calendar-crm/check-availability", {
          start: parsed.parsed.start,
          end: parsed.parsed.end,
          participantEmails: input.participantEmails,
        }),
        api.post<{ slots: SuggestedSlot[] }>("/api/calendar-crm/suggest-slots", {
          start: parsed.parsed.start,
          durationMinutes: parsed.parsed.durationMinutes,
          participantEmails: input.participantEmails,
        }),
      ]);
      return { parsed, availability: checked, slots: slots.slots };
    },
    onSuccess: ({ parsed, availability: checked, slots }) => {
      setParsedSchedule(parsed.parsed);
      setAvailability(checked);
      setScheduleMessage(parsed.message ?? null);
      setAmbiguityConfirmed(false);
      const requested =
        parsed.parsed && checked?.available
          ? [
              {
                start: parsed.parsed.start,
                end: parsed.parsed.end,
                label: parsed.parsed.interpretation,
              },
            ]
          : [];
      const unique = [...requested, ...slots].filter(
        (slot, index, all) =>
          all.findIndex((candidate) => candidate.start === slot.start) === index,
      );
      setSuggestedSlots(unique);
      setSelectedSlot(unique[0] ?? null);
    },
  });

  useEffect(() => {
    if (!props.open) return;
    if (!hasSchedulingIntent(schedulingContext)) {
      resetScheduleResults();
      setScheduleMessage(null);
      return;
    }
    const timer = window.setTimeout(() => {
      parseScheduleMutation.mutate({
        text: schedulingContext,
        participantEmails: attendeeEmails,
      });
    }, 700);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attendeeEmails, props.open, schedulingContext]);

  function resetScheduleResults() {
    setParsedSchedule(null);
    setAvailability(null);
    setSuggestedSlots([]);
    setSelectedSlot(null);
    setAmbiguityConfirmed(false);
  }

  const bookingMutation = useMutation({
    mutationFn: async () => {
      if (!selectedSlot) throw new Error("Select a time slot first");
      return api.post("/api/calendar-crm/events", {
        title: meetingTitle.trim() || "Meeting",
        start: selectedSlot.start,
        end: selectedSlot.end,
        attendees: attendeeEmails.map((email) => ({ email })),
        description: meetingDescription.trim() || undefined,
        location: meetingLocation.trim() || undefined,
        confirmed: true as const,
        addMeetLink,
        sourceThreadId: thread.id,
      });
    },
    onSuccess: async () => {
      setBookingConfirmationOpen(false);
      props.onNotice("Meeting created and added to Ember Calendar.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.events.all }),
        props.invalidateInbox(),
      ]);
    },
  });

  const composerError = firstError(
    generateReplyMutation.error,
    saveDraftMutation.error,
    discardDraftMutation.error,
    parseScheduleMutation.error,
  );
  const canReviewBooking = Boolean(
    selectedSlot && (!parsedSchedule?.isAmbiguous || ambiguityConfirmed),
  );
  const insertSlotIntoReply = (slot: SuggestedSlot) => {
    const sentence = `Would ${formatDateRange(slot.start, slot.end, session.user.timezone)} (${session.user.timezone}) work for you?`;
    setReplyBody((current) => (current.trim() ? `${current.trim()}\n\n${sentence}` : sentence));
    setSelectedSlot(slot);
  };

  return (
    <>
      <Dialog open={props.open} onOpenChange={props.onOpenChange}>
        <DialogContent className="bottom-0 left-0 top-auto flex h-[min(94dvh,920px)] w-full max-w-none translate-x-0 translate-y-0 flex-col overflow-hidden rounded-b-none rounded-t-2xl p-0 sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:h-[min(90dvh,900px)] sm:max-w-4xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl">
          <DialogHeader className="shrink-0 border-b border-border px-4 py-4 pr-12 sm:px-6">
            <DialogTitle>Create draft</DialogTitle>
            <DialogDescription className="truncate">
              To: {thread.fromEmail ?? "Thread participant"} · {detail?.thread.subject || thread.subject || "No subject"}
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5">
            {Boolean(composerError) && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900" role="alert">
                <span>{errorMessage(composerError)}</span>
                {composerError instanceof ApiClientError && ["GOOGLE_REAUTH_REQUIRED", "GOOGLE_PERMISSION_REQUIRED"].includes(composerError.code) && <a href="/api/auth/google" className="font-semibold underline">Reconnect Google</a>}
                {composerError instanceof ApiClientError && composerError.code === "UNAUTHORIZED" && <a href="/login" className="font-semibold underline">Sign in again</a>}
              </div>
            )}

            <section className="rounded-lg border border-border bg-card">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
                <div>
                  <h3 className="text-sm font-semibold">Message</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">AI suggestions remain editable and are never sent automatically.</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => generateReplyMutation.mutate(Boolean(replyBody.trim()))}
                  disabled={generateReplyMutation.isPending}
                >
                  {generateReplyMutation.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}
                  Suggest Message Reply
                </Button>
              </div>
              <Textarea
                value={replyBody}
                onChange={(event) => setReplyBody(event.target.value)}
                placeholder="Write a reply or request an AI suggestion…"
                className="min-h-56 resize-y rounded-none border-0 px-4 py-4 text-sm leading-6 shadow-none focus-visible:ring-0 sm:min-h-64"
              />
              <p className="border-t border-border px-4 py-2 text-[11px] leading-4 text-muted-foreground">
                Suggestions use recent thread context with email addresses, phone numbers, tokens, and links masked where possible.
              </p>
            </section>

            <section className="rounded-lg border border-border bg-card">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
                <div>
                  <h3 className="flex items-center gap-2 text-sm font-semibold"><CalendarDays className="h-4 w-4" /> Scheduling</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">{session.user.timezone} · working hours {session.user.workingHoursStart}–{session.user.workingHoursEnd}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => parseScheduleMutation.mutate({ text: schedulingContext, participantEmails: attendeeEmails })}
                  disabled={!schedulingContext.trim() || parseScheduleMutation.isPending}
                >
                  {parseScheduleMutation.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                  Check availability
                </Button>
              </div>

              <div className="space-y-4 p-4">
                {parseScheduleMutation.isPending && !parsedSchedule && (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Detecting meeting details and checking Calendar…</p>
                )}
                {!parseScheduleMutation.isPending && !parsedSchedule && (
                  <p className="text-sm text-muted-foreground">
                    {scheduleMessage ?? "No specific meeting time detected yet. Add a date or time to your reply and availability will be checked automatically."}
                  </p>
                )}

                {parsedSchedule && (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-3 rounded-md bg-muted/50 p-3">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Interpreted as</p>
                        <p className="mt-1 text-sm font-semibold">{parsedSchedule.interpretation}</p>
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${availability?.available ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>
                        {availability?.available ? "Available" : "Conflict found"}
                      </span>
                    </div>
                    {availability && !availability.available && (
                      <p className="text-xs text-amber-800">{availability.reason} Nearby available times are shown below.</p>
                    )}
                    {parsedSchedule.isAmbiguous && (
                      <label className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
                        <input className="mt-1" type="checkbox" checked={ambiguityConfirmed} onChange={(event) => setAmbiguityConfirmed(event.target.checked)} />
                        <span><strong>Confirm {parsedSchedule.interpretation}.</strong><br /><span className="text-xs text-amber-800">{parsedSchedule.ambiguityReason}</span></span>
                      </label>
                    )}
                  </div>
                )}

                {suggestedSlots.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-semibold">Recommended times</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {suggestedSlots.map((slot) => (
                        <div key={slot.start} className={`rounded-md border p-3 ${selectedSlot?.start === slot.start ? "border-foreground bg-muted/60 ring-1 ring-foreground" : "border-border"}`}>
                          <button type="button" className="w-full text-left" onClick={() => setSelectedSlot(slot)}>
                            <span className="block text-sm font-semibold">{formatDateTime(slot.start, session.user.timezone)}</span>
                            <span className="mt-0.5 block text-xs text-muted-foreground">{formatTime(slot.start, session.user.timezone)}–{formatTime(slot.end, session.user.timezone)} · {session.user.timezone}</span>
                          </button>
                          <Button size="sm" variant="ghost" className="mt-2 h-7 px-2 text-xs" onClick={() => insertSlotIntoReply(slot)}>Insert into reply</Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {(parsedSchedule || suggestedSlots.length > 0) && (
                  <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
                    <Field label="Meeting title"><Input value={meetingTitle} onChange={(event) => setMeetingTitle(event.target.value)} placeholder="Client catch-up" /></Field>
                    <Field label="Participants"><Input value={attendeeText} onChange={(event) => setAttendeeText(event.target.value)} placeholder="alex@example.com" /></Field>
                    <Field label="Location"><Input value={meetingLocation} onChange={(event) => setMeetingLocation(event.target.value)} placeholder="Office or address" /></Field>
                    <label className="flex h-10 items-center gap-2 self-end rounded-md border border-border px-3 text-sm"><input type="checkbox" checked={addMeetLink} onChange={(event) => setAddMeetLink(event.target.checked)} /><Video className="h-4 w-4" /> Add Google Meet</label>
                    <div className="sm:col-span-2"><Field label="Calendar description and email context"><Textarea value={meetingDescription} onChange={(event) => setMeetingDescription(event.target.value)} className="min-h-24" /></Field></div>
                    <div className="flex flex-wrap items-center justify-between gap-2 sm:col-span-2">
                      <p className="text-[11px] text-muted-foreground">A confirmation step appears before Calendar is changed.</p>
                      <Button onClick={() => setBookingConfirmationOpen(true)} disabled={!canReviewBooking}><CalendarDays /> Create Calendar event</Button>
                    </div>
                  </div>
                )}
              </div>
            </section>
          </div>

          <DialogFooter className="shrink-0 flex-wrap border-t border-border bg-background px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3 sm:px-6 sm:pb-4">
            <Button variant="ghost" onClick={() => discardDraftMutation.mutate()} disabled={discardDraftMutation.isPending} className="mr-auto text-muted-foreground"><Trash2 /> Discard</Button>
            <Button variant="outline" onClick={() => saveDraftMutation.mutate()} disabled={!replyBody.trim() || saveDraftMutation.isPending}>
              {saveDraftMutation.isPending ? <Loader2 className="animate-spin" /> : <Save />} Save draft
            </Button>
            <Button onClick={() => setSendConfirmationOpen(true)} disabled={!replyBody.trim()}><Send /> Review and send</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={sendConfirmationOpen} onOpenChange={setSendConfirmationOpen}>
        <DialogContent className="max-w-xl p-6">
          <DialogHeader>
            <DialogTitle>Send this reply?</DialogTitle>
            <DialogDescription>Review the final recipient and message. This is the only step that sends email.</DialogDescription>
          </DialogHeader>
          <div className="my-5 rounded-lg border border-border bg-muted/40 p-4 text-sm">
            <p className="font-medium">To: {thread.fromEmail ?? "Thread participant"}</p>
            <p className="mt-3 max-h-60 whitespace-pre-wrap overflow-auto text-muted-foreground">{replyBody}</p>
          </div>
          {sendReplyMutation.error && (
            <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert">{errorMessage(sendReplyMutation.error)}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSendConfirmationOpen(false)}>Keep editing</Button>
            <Button onClick={() => sendReplyMutation.mutate()} disabled={!replyBody.trim() || sendReplyMutation.isPending}>
              {sendReplyMutation.isPending ? <Loader2 className="animate-spin" /> : <Send />} Confirm and send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bookingConfirmationOpen} onOpenChange={setBookingConfirmationOpen}>
        <DialogContent className="max-w-lg p-6">
          <DialogHeader>
            <DialogTitle>Create this calendar event?</DialogTitle>
            <DialogDescription>No Calendar change occurs until you confirm below.</DialogDescription>
          </DialogHeader>
          {selectedSlot && (
            <div className="my-5 space-y-2 rounded-lg border border-border bg-muted/40 p-4 text-sm">
              <p className="font-semibold">{meetingTitle || "Meeting"}</p>
              <p>{formatDateRange(selectedSlot.start, selectedSlot.end, session.user.timezone)}</p>
              {attendeeEmails.length > 0 && <p className="text-muted-foreground">Guests: {attendeeEmails.join(", ")}</p>}
              {addMeetLink && <p className="text-muted-foreground">Google Meet link requested</p>}
            </div>
          )}
          {bookingMutation.error && (
            <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert">{errorMessage(bookingMutation.error)}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setBookingConfirmationOpen(false)}>Go back</Button>
            <Button onClick={() => bookingMutation.mutate()} disabled={bookingMutation.isPending}>
              {bookingMutation.isPending ? <Loader2 className="animate-spin" /> : <CalendarDays />} Confirm booking
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function firstError(...errors: unknown[]) {
  return errors.find(Boolean);
}
function hasSchedulingIntent(value: string) {
  return /\b(meet|meeting|schedule|call|appointment|availability|free at|available on|book a time|time slot|sync up|catch up|catchup|let'?s talk|discussion)\b/i.test(value);
}
function formatDateTime(value: string, timezone: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-SG", { timeZone: timezone, weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}
function formatTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-SG", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(new Date(value));
}
function formatDateRange(start: string, end: string, timezone: string) {
  return `${formatDateTime(start, timezone)} – ${formatTime(end, timezone)}`;
}
```

- [ ] **Step 4: Remove the extracted code from `crm.tsx`**

In `apps/web/src/routes/crm.tsx`:

1. Delete these `CrmDashboard`-local pieces of state (now owned by
   `ComposerDialog`): `replyBody`, `replyDraftId`, `draftHydratedFor`,
   `sendConfirmationOpen`, `parsedSchedule`, `availability`,
   `suggestedSlots`, `selectedSlot`, `scheduleMessage`,
   `ambiguityConfirmed`, `meetingTitle`, `meetingDescription`,
   `meetingLocation`, `attendeeText`, `addMeetLink`, `sourceThreadId`,
   `bookingConfirmationOpen`, and the `attendeeEmails` memo.
2. Delete the mutations: `generateReplyMutation`, `saveDraftMutation`,
   `discardDraftMutation`, `sendReplyMutation`, `parseScheduleMutation`,
   `bookingMutation`, and the `schedulingContext` memo, the `useEffect`
   that runs `parseScheduleMutation`, and `insertSlotIntoReply`.
3. Delete the `useEffect` that hydrates `replyBody`/`replyDraftId` from
   `threadDetailQuery.data` (the one guarded by `draftHydratedFor`).
4. Replace `openComposerForThread` with:

```ts
  const openComposerForThread = (thread: EmailThread) => {
    setSelectedThreadId(thread.gmailThreadId);
    setComposerOpen(true);
  };
```

5. Delete `resetScheduleResults`.
6. Delete the three `<Dialog>` blocks for the composer, send-confirmation,
   and booking-confirmation (everything from `<Dialog open={composerOpen}
   ...>` through the closing `</Dialog>` of the booking-confirmation
   dialog — the account-action `<Dialog>` after it stays).
7. In `CrmDashboard`'s JSX, right where those three dialogs used to be,
   add:

```tsx
      {composerOpen && selectedThread && (
        <ComposerDialog
          mode="reply"
          open={composerOpen}
          onOpenChange={setComposerOpen}
          thread={selectedThread}
          detail={threadDetailQuery.data}
          session={session}
          invalidateInbox={invalidateInbox}
          onNotice={setNotice}
        />
      )}
```

8. Delete the local `Field` function at the bottom of `crm.tsx` and
   replace its two call sites in `PrivacyView` (`<Field label="IANA
   timezone">`, `<Field label="Working day starts">`, `<Field
   label="Working day ends">`) with the imported one — no change to those
   call sites themselves, just where `Field` comes from now.
9. Delete the local `errorMessage` function at the bottom of `crm.tsx`
   (its one remaining caller in this file, the top-level `topError`
   banner's `errorMessage(topError)`, now resolves to the imported one).
10. Delete the now-unused bottom-of-file helpers that moved into
    `composer-dialog.tsx`: `hasSchedulingIntent`, `formatDateTime`,
    `formatTime`, `formatDateRange`. Leave `firstError` in `crm.tsx` —
    it's still used by the `topError` computation there (`composer-
    dialog.tsx` has its own private copy for `composerError`, which is
    fine — it's a 2-line pure helper, not worth sharing).
11. Update the imports at the top of `crm.tsx`:
    - Add: `import { ComposerDialog } from "@/components/crm/composer-dialog";`
    - Add: `import { Field } from "@/components/ui/field";`
    - In the `@/lib/crm` import, add `errorMessage` and remove the now
      unused `AvailabilityResult, ParsedSchedule, SuggestedReply,
      SuggestedSlot` type imports (keep the rest: `EmailCategory,
      EmailPriority, EmailStatus, EmailThread, GmailStats, PrivacySummary,
      SessionData, AuditLog, googleSignInUrl, loadSession` are all still
      used elsewhere in `crm.tsx`).
    - Remove `CalendarDays, RefreshCw, Save, Send, Trash2, Video` from the
      `lucide-react` import list — none of these are referenced anywhere
      else in `crm.tsx` after this extraction (keep `Sparkles`, still used
      by the "Create Draft" button icon in `ThreadDetailPanel`, and keep
      every other icon already imported for the rest of the file).
    - Remove `import { queryKeys } from "@/lib/query-keys";` —
      `bookingMutation` was its only user in this file, and that mutation
      moved to `composer-dialog.tsx`.
    - Keep the `@/components/ui/dialog` import as-is (`Dialog,
      DialogContent, DialogHeader, DialogTitle, DialogDescription,
      DialogFooter`) — the account-action dialog, which stays in
      `crm.tsx`, still uses all of them.

- [ ] **Step 5: Verify with typecheck, lint, and a manual regression pass**

Run: `pnpm --filter web typecheck`
Expected: PASS

Run: `pnpm --filter web lint`
Expected: PASS

Manual regression pass (start `pnpm --filter api dev` and `pnpm --filter
web dev`): sign in, open `/crm`, select a thread, click **Create Draft**.
Confirm: the dialog opens with the same layout as before; "Suggest
Message Reply" still works; typing a message containing a time (e.g.
"call this Tuesday at 3pm") still triggers the scheduling section with
availability/suggested slots; selecting a slot and clicking **Create
Calendar event** still opens its own confirmation and creates the event;
**Save draft**, **Discard**, and **Review and send → Confirm and send**
all still work exactly as before. Also verify `/m/crm` (mobile route)
still renders the same dialog correctly, since it reuses `CrmDashboard`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/ui/field.tsx apps/web/src/components/crm/composer-dialog.tsx apps/web/src/lib/crm.ts apps/web/src/routes/crm.tsx
git commit -m "refactor(web): extract the reply composer into ComposerDialog"
```

---

## Task 6: Compose button and new-message mode

**Files:**
- Modify: `apps/web/src/components/crm/composer-dialog.tsx`
- Modify: `apps/web/src/routes/crm.tsx`
- Modify: `apps/web/src/lib/crm.ts` (add a small response type)

**Interfaces:**
- Consumes: `POST /api/gmail/send` (Task 4), `CalendarBooking` type
  (`@/lib/crm`).
- Produces: `<ComposerDialog mode="new" open onOpenChange session
  recentContacts invalidateInbox onNotice />` and a **Compose** button in
  `InboxView`'s toolbar that opens it.

No frontend test runner exists in this repo — verification is
`pnpm typecheck`/`pnpm lint` plus a full manual walkthrough of the new
flow in a browser (the natural-language scheduling behavior itself is
already covered by backend Vitest tests in `scheduler.ts`/`crm.test.ts`
and is unchanged by this task).

- [ ] **Step 1: Add a response type to `apps/web/src/lib/crm.ts`**

Add near the other response-shaped interfaces (e.g. next to
`AvailabilityResult`):

```ts
export interface SendMessageResult {
  sent: boolean;
  messageId: string;
  threadId: string;
  booking: CalendarBooking | null;
  bookingError?: string;
}
```

- [ ] **Step 2: Widen `ComposerDialogProps` to a `mode` union**

In `apps/web/src/components/crm/composer-dialog.tsx`, replace the current
`interface ComposerDialogProps { mode: "reply"; ... }` with:

```ts
interface ComposerDialogCommonProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: SessionData;
  invalidateInbox: () => Promise<void>;
  onNotice: (message: string) => void;
}

interface RecentContact {
  email: string;
  name: string | null;
}

type ComposerDialogProps =
  | (ComposerDialogCommonProps & {
      mode: "reply";
      thread: EmailThread;
      detail: ThreadDetailData | undefined;
    })
  | (ComposerDialogCommonProps & {
      mode: "new";
      recentContacts: RecentContact[];
    });
```

Update the `@/lib/crm` import at the top of the file to also bring in
`SendMessageResult` (keep `errorMessage` — it's a value import from
Task 5, not a type, so it stays outside the `type` markers):

```ts
import {
  type AvailabilityResult,
  type EmailThread,
  errorMessage,
  type ParsedSchedule,
  type SendMessageResult,
  type SessionData,
  type SuggestedReply,
  type SuggestedSlot,
  type ThreadDetailData,
} from "@/lib/crm";
```

- [ ] **Step 3: Branch the component body on `props.mode`**

Inside `ComposerDialog`, right after `const { session } = props;` (drop
the earlier `const { thread, detail, session } = props;` destructure —
`thread`/`detail` are only valid in reply mode now), add:

```ts
  const isReply = props.mode === "reply";
  const thread = isReply ? props.thread : undefined;
  const detail = isReply ? props.detail : undefined;
```

Everywhere the rest of the component currently references `thread.id`,
`thread.gmailThreadId`, `thread.subject`, `thread.snippet`,
`thread.fromEmail`, replace with a small set of **mode-neutral derived
values** computed once near the top of the component (after the state
declarations), so the rest of the JSX/logic doesn't need per-reference
branching:

```ts
  const [toEmail, setToEmail] = useState("");
  const [subject, setSubject] = useState("");

  const recipientEmail = isReply ? (thread!.fromEmail ?? "") : toEmail.trim();
  const messageSubject = isReply ? (detail?.thread.subject || thread!.subject || "") : subject;
  const dialogKey = isReply ? thread!.gmailThreadId : "new";
  const toEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail.trim());
  // Only ever read by mutations that are exclusively defined and invoked
  // in reply mode (generateReplyMutation, saveDraftMutation,
  // discardDraftMutation, sendReplyMutation, bookingMutation) — this
  // typed alias avoids repeating a non-null assertion at every one of
  // their `thread.xxx` references now that `thread` is optional.
  const replyThread = thread as EmailThread;
```

Then apply these mechanical replacements throughout the rest of the
component (all inside the same file from Task 5):

- The reset-on-open `useEffect`: guard the thread-specific defaults with
  `isReply`, and reset the new-mode fields too:

```ts
  useEffect(() => {
    if (!props.open) return;
    if (isReply) {
      setMeetingTitle(thread!.subject ?? "Meeting");
      setMeetingDescription(
        `Scheduled from Gmail thread: ${thread!.subject ?? "Untitled conversation"}\n\nEmail context: ${thread!.snippet ?? ""}`,
      );
      setAttendeeText(thread!.fromEmail ?? "");
    } else {
      setToEmail("");
      setSubject("");
      setMeetingTitle("");
      setMeetingDescription("");
      setAttendeeText("");
    }
    setMeetingLocation("");
    setAddMeetLink(false);
    setAttachMeeting(true);
    setParsedSchedule(null);
    setAvailability(null);
    setSuggestedSlots([]);
    setSelectedSlot(null);
    setAmbiguityConfirmed(false);
    setScheduleMessage(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open, dialogKey]);
```

- The draft-hydration `useEffect` (replies only — new mode has nothing to
  hydrate from the server): guard it with `isReply`:

```ts
  useEffect(() => {
    if (!isReply || !detail || draftHydratedFor === thread!.gmailThreadId) return;
    const latestDraft = detail.replies.find((reply) => reply.status !== "sent");
    setReplyBody(latestDraft?.body ?? "");
    setReplyDraftId(latestDraft?.id ?? null);
    setDraftHydratedFor(thread!.gmailThreadId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, draftHydratedFor, isReply]);
```

- `generateReplyMutation`, `saveDraftMutation`, `discardDraftMutation`,
  `sendReplyMutation`, `bookingMutation`: these five stay reply-only (new
  mode has no AI-suggest/save-draft/discard-draft, and books through
  `sendMessageMutation` below instead — see the design spec). Guard their
  call sites in the JSX footer/header with `isReply` (Step 4 below). In
  their bodies exactly as written in Task 5, replace every remaining bare
  `thread.` reference with `replyThread.` (the alias added above) — this
  is: the `/api/gmail/${thread.gmailThreadId}/...` URL in each of
  `generateReplyMutation`, `saveDraftMutation`, `discardDraftMutation`,
  and `sendReplyMutation`; `to: thread.fromEmail ?? undefined` and the
  `["crm", "thread", thread.gmailThreadId]` query key in
  `saveDraftMutation`'s and `sendReplyMutation`'s bodies; and
  `sourceThreadId: thread.id` in `bookingMutation`. (`schedulingContext`
  and the two `useEffect`s already use `thread!` directly instead, per
  the rewritten code above — leave those as `thread!`, not
  `replyThread`.)

- Add a new mutation, `sendMessageMutation`, for the new-mode send path:

```ts
  const sendMessageMutation = useMutation({
    mutationFn: () =>
      api.post<SendMessageResult>("/api/gmail/send", {
        to: toEmail.trim(),
        subject: subject.trim(),
        body: replyBody,
        confirmed: true as const,
        ...(attachMeeting && canReviewBooking && selectedSlot
          ? {
              meeting: {
                title: meetingTitle.trim() || "Meeting",
                start: selectedSlot.start,
                end: selectedSlot.end,
                attendees: attendeeEmails.map((email) => ({ email })),
                description: meetingDescription.trim() || undefined,
                location: meetingLocation.trim() || undefined,
                addMeetLink,
              },
            }
          : {}),
      }),
    onSuccess: async (data) => {
      setSendConfirmationOpen(false);
      props.onOpenChange(false);
      setReplyBody("");
      await props.invalidateInbox();
      if (data.booking) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.events.all });
        props.onNotice(
          data.bookingError
            ? `Message sent, but the calendar event could not be created: ${data.bookingError}`
            : "Message sent and added to Ember Calendar.",
        );
      } else {
        props.onNotice("Message sent.");
      }
    },
  });
```

(`queryKeys` is already imported in this file from Task 5 — it's used
above and by the existing `bookingMutation`.)

- `schedulingContext`: for new mode there's no prior thread to reference,
  so simplify:

```ts
  const schedulingContext = useMemo(() => {
    if (!isReply) return replyBody.slice(0, 50_000);
    const messages =
      [...(detail?.thread.messages ?? [])]
        .reverse()
        .slice(0, 6)
        .map((message) => message.bodyText || message.snippet)
        .join("\n\n") ||
      thread!.snippet ||
      "";
    return `Draft reply:\n${replyBody}\n\nMost recent conversation first:\n${messages}`.slice(
      0,
      50_000,
    );
  }, [detail, isReply, replyBody, thread]);
```

- `bookingMutation`: reply-mode only (new mode books through
  `sendMessageMutation` instead) — no change needed, but its
  `sourceThreadId: thread.id` reference becomes `sourceThreadId:
  thread!.id` (safe, since this mutation is only ever invoked from
  reply-mode JSX, guarded by `isReply` in Step 4).

- Add the "attach a calendar invite" toggle state, next to the other
  meeting-field state declarations:

```ts
  const [attachMeeting, setAttachMeeting] = useState(true);
```

- Add a `recentContacts` lookup for the datalist (new mode only) — no new
  state needed, it's read straight from `props.recentContacts` in the
  JSX.

- [ ] **Step 4: Update the JSX for mode-specific rendering**

In the main composer `<Dialog>`:

- `DialogTitle`: `{isReply ? "Create draft" : "Compose message"}`
- `DialogDescription`: for reply mode, keep exactly as before. For new
  mode, drop the description line entirely and instead render To/Subject
  inputs as the first two fields of the "Message" section. Concretely,
  replace the current `<DialogHeader>` block with:

```tsx
          <DialogHeader className="shrink-0 border-b border-border px-4 py-4 pr-12 sm:px-6">
            <DialogTitle>{isReply ? "Create draft" : "Compose message"}</DialogTitle>
            {isReply && (
              <DialogDescription className="truncate">
                To: {thread!.fromEmail ?? "Thread participant"} · {detail?.thread.subject || thread!.subject || "No subject"}
              </DialogDescription>
            )}
          </DialogHeader>
```

- In the "Message" section, right above the existing `<Textarea
  value={replyBody} .../>`, add (new mode only). Guard this block with
  `props.mode === "new"` (not the `isReply` boolean) so TypeScript narrows
  `props` to the `"new"` variant and `props.recentContacts` type-checks
  without a cast:

```tsx
              {props.mode === "new" && (
                <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-2">
                  <Field label="To">
                    <Input
                      type="email"
                      list="composer-recent-contacts"
                      value={toEmail}
                      onChange={(event) => setToEmail(event.target.value)}
                      placeholder="alex@example.com"
                    />
                    <datalist id="composer-recent-contacts">
                      {props.recentContacts.map((contact) => (
                        <option key={contact.email} value={contact.email}>
                          {contact.name ?? contact.email}
                        </option>
                      ))}
                    </datalist>
                  </Field>
                  <Field label="Subject">
                    <Input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Project kickoff" />
                  </Field>
                </div>
              )}
```

- The "Create Calendar event" button + its dedicated confirmation dialog:
  wrap the button in `isReply &&`, and wrap the entire third `<Dialog
  open={bookingConfirmationOpen} ...>` block at the bottom in `{isReply &&
  (...)}`. In its place (new mode only), inside the same
  `sm:col-span-2` row as the existing "confirmation step" hint paragraph,
  add a checkbox:

```tsx
                    {!isReply && (
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={attachMeeting}
                          disabled={!canReviewBooking}
                          onChange={(event) => setAttachMeeting(event.target.checked)}
                        />
                        Attach a calendar invite for this time
                      </label>
                    )}
```

placed directly above the existing `<p className="text-[11px] ...">A
confirmation step appears before Calendar is changed.</p>` line, and hide
that paragraph in new mode (it only applies to the reply flow's separate
booking step) by wrapping it in `{isReply && (...)}` too, and hide the
"Create Calendar event" button in new mode (wrap in `{isReply && (...)}`
as well, since new mode books via the merged send-confirmation instead).

- Footer buttons: reply mode keeps all four buttons unchanged. New mode
  only shows **Discard** (no API call — just closes) and **Review and
  send**:

```tsx
          <DialogFooter className="shrink-0 flex-wrap border-t border-border bg-background px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3 sm:px-6 sm:pb-4">
            {isReply ? (
              <>
                <Button variant="ghost" onClick={() => discardDraftMutation.mutate()} disabled={discardDraftMutation.isPending} className="mr-auto text-muted-foreground"><Trash2 /> Discard</Button>
                <Button variant="outline" onClick={() => saveDraftMutation.mutate()} disabled={!replyBody.trim() || saveDraftMutation.isPending}>
                  {saveDraftMutation.isPending ? <Loader2 className="animate-spin" /> : <Save />} Save draft
                </Button>
              </>
            ) : (
              <Button variant="ghost" onClick={() => props.onOpenChange(false)} className="mr-auto text-muted-foreground"><Trash2 /> Discard</Button>
            )}
            <Button
              onClick={() => setSendConfirmationOpen(true)}
              disabled={isReply ? !replyBody.trim() : !(toEmailValid && subject.trim() && replyBody.trim())}
            >
              <Send /> Review and send
            </Button>
          </DialogFooter>
```

- The **Suggest Message Reply** button (AI suggestion) is reply-only —
  wrap it in `{isReply && (...)}`, since there's no thread context to
  suggest from in new mode.

- The send-confirmation `<Dialog>`: show the recipient/message for both
  modes, and add a meeting summary block plus branch the submit handler:

```tsx
      <Dialog open={sendConfirmationOpen} onOpenChange={setSendConfirmationOpen}>
        <DialogContent className="max-w-xl p-6">
          <DialogHeader>
            <DialogTitle>{isReply ? "Send this reply?" : "Send this message?"}</DialogTitle>
            <DialogDescription>Review the final recipient and message. This is the only step that sends email.</DialogDescription>
          </DialogHeader>
          <div className="my-5 space-y-3 rounded-lg border border-border bg-muted/40 p-4 text-sm">
            <div>
              <p className="font-medium">To: {isReply ? (thread!.fromEmail ?? "Thread participant") : recipientEmail}</p>
              {!isReply && <p className="font-medium">Subject: {messageSubject}</p>}
              <p className="mt-3 max-h-60 whitespace-pre-wrap overflow-auto text-muted-foreground">{replyBody}</p>
            </div>
            {!isReply && attachMeeting && canReviewBooking && selectedSlot && (
              <div className="border-t border-border pt-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Also creates a calendar event</p>
                <p className="mt-1 font-semibold">{meetingTitle || "Meeting"}</p>
                <p>{formatDateRange(selectedSlot.start, selectedSlot.end, session.user.timezone)}</p>
                {attendeeEmails.length > 0 && <p className="text-muted-foreground">Guests: {attendeeEmails.join(", ")}</p>}
                {addMeetLink && <p className="text-muted-foreground">Google Meet link requested</p>}
              </div>
            )}
          </div>
          {(isReply ? sendReplyMutation.error : sendMessageMutation.error) && (
            <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert">
              {errorMessage(isReply ? sendReplyMutation.error : sendMessageMutation.error)}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSendConfirmationOpen(false)}>Keep editing</Button>
            <Button
              onClick={() => (isReply ? sendReplyMutation.mutate() : sendMessageMutation.mutate())}
              disabled={
                (isReply ? !replyBody.trim() : !(toEmailValid && subject.trim() && replyBody.trim())) ||
                (isReply ? sendReplyMutation.isPending : sendMessageMutation.isPending)
              }
            >
              {(isReply ? sendReplyMutation.isPending : sendMessageMutation.isPending) ? <Loader2 className="animate-spin" /> : <Send />} Confirm and send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
```

(This replaces the existing send-confirmation `<Dialog>` block from
Task 5 in place.)

- Seed `meetingTitle`/`attendeeText` from `subject`/`toEmail` the first
  time a meeting is detected in new mode, without overwriting later user
  edits — add this to `parseScheduleMutation`'s `onSuccess`, right after
  the existing `setSuggestedSlots(unique); setSelectedSlot(unique[0] ??
  null);` lines:

```ts
      if (!isReply) {
        if (!meetingTitle.trim() && subject.trim()) setMeetingTitle(subject.trim());
        if (!attendeeText.trim() && toEmail.trim()) setAttendeeText(toEmail.trim());
      }
```

- [ ] **Step 5: Wire up `recentContacts` and the Compose button in `crm.tsx`**

In `apps/web/src/routes/crm.tsx`:

1. Add `composeMode` state, right next to `composerOpen`:

```ts
  const [composeMode, setComposeMode] = useState<"reply" | "new">("reply");
```

2. Add an `openComposerNew` handler, right after `openComposerForThread`:

```ts
  const openComposerNew = () => {
    setComposeMode("new");
    setComposerOpen(true);
  };
```

3. Change `openComposerForThread` to also set the mode:

```ts
  const openComposerForThread = (thread: EmailThread) => {
    setSelectedThreadId(thread.gmailThreadId);
    setComposeMode("reply");
    setComposerOpen(true);
  };
```

4. Add a `recentContacts` memo, derived from the already-loaded inbox
   threads (no extra request):

```ts
  const recentContacts = useMemo(() => {
    const seen = new Map<string, string | null>();
    for (const thread of threads) {
      if (thread.fromEmail && !seen.has(thread.fromEmail)) {
        seen.set(thread.fromEmail, thread.fromName);
      }
    }
    return [...seen.entries()].map(([email, name]) => ({ email, name }));
  }, [threads]);
```

5. Replace the single `<ComposerDialog mode="reply" .../>` block added in
   Task 5 with mode-conditional rendering:

```tsx
      {composerOpen && composeMode === "reply" && selectedThread && (
        <ComposerDialog
          mode="reply"
          open={composerOpen}
          onOpenChange={setComposerOpen}
          thread={selectedThread}
          detail={threadDetailQuery.data}
          session={session}
          invalidateInbox={invalidateInbox}
          onNotice={setNotice}
        />
      )}
      {composerOpen && composeMode === "new" && (
        <ComposerDialog
          mode="new"
          open={composerOpen}
          onOpenChange={setComposerOpen}
          session={session}
          recentContacts={recentContacts}
          invalidateInbox={invalidateInbox}
          onNotice={setNotice}
        />
      )}
```

6. Add the **Compose** button. In `InboxView`'s props interface, add
   `onCompose: () => void;`. In `CrmDashboard`'s `<InboxView ... />`
   invocation, add `onCompose={openComposerNew}`. Inside `InboxView`'s
   JSX, in the header row's `ml-auto` group (the one currently containing
   the "Auto-sync on" indicator and the refresh icon button), add the
   button before the sync button:

```tsx
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden items-center gap-1.5 sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Auto-sync on</span>
            <Button size="sm" variant="outline" onClick={props.onCompose}>
              <SquarePen /> Compose
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={props.onSync} disabled={props.syncing} aria-label="Refresh Gmail now" title="Refresh Gmail now">
              {props.syncing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            </Button>
          </div>
```

7. Add `SquarePen` to the `lucide-react` import list at the top of
   `crm.tsx`.

- [ ] **Step 6: Verify with typecheck, lint, and a full manual walkthrough**

Run: `pnpm --filter web typecheck`
Expected: PASS

Run: `pnpm --filter web lint`
Expected: PASS

Manual walkthrough (start `pnpm --filter api dev` and `pnpm --filter web
dev`, sign in, open `/crm`):

1. Click **Compose**. Confirm the dialog opens titled "Compose message"
   with empty To/Subject/Body fields and no scheduling section content
   yet.
2. Type a recipient, subject, and a body containing a natural-language
   time, e.g. "Let's have a call this Tuesday at 12:00 PM." Confirm the
   Scheduling section detects it (same debounce/UI as the reply flow),
   shows availability, and — if that slot conflicts with an existing
   Calendar event — shows alternative suggested times.
3. Confirm the "Attach a calendar invite for this time" checkbox is
   checked by default once a slot is available, and that meeting
   title/attendees default from Subject/To.
4. Click **Review and send**. Confirm the confirmation dialog shows the
   message AND the meeting block together, then click **Confirm and
   send**.
5. Confirm: the dialog closes, a "Message sent and added to Ember
   Calendar." notice appears, the new conversation appears in the Inbox
   list, and the event appears on the main **Calendar** page (`/calendar`)
   with no duplicate.
6. Repeat compose with a body proposing a time that conflicts with the
   event just created. Confirm the conflict is detected, alternative
   slots are suggested, and confirming a different slot creates a second,
   non-overlapping event (no duplicate at the original time).
7. Compose a message with **no** scheduling language at all ("Just
   checking in — let me know your thoughts."), send it, and confirm it
   sends successfully with `booking: null` and no calendar event is
   created.
8. Re-run the Task 5 reply-flow regression checklist once more end-to-end
   to confirm nothing regressed now that both modes share the component.
9. Repeat steps 1–5 on `/m/crm` to confirm the mobile route behaves
   identically.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/crm/composer-dialog.tsx apps/web/src/routes/crm.tsx apps/web/src/lib/crm.ts
git commit -m "feat(web): add Compose button with integrated new-message scheduling"
```
