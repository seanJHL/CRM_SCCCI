/**
 * Calendar CRM routes — NLP scheduling, availability checking,
 * and event creation/update/cancellation with explicit confirmation.
 * No event is created or modified without user confirmation.
 */

import { Hono } from "hono";
import { z } from "zod";
import { eq, and, ne, sql } from "drizzle-orm";
import type { AppBindings } from "@/types";
import { createDatabase } from "@/db";
import {
  calendarBookings,
  emailThreads,
  meetingRequests,
} from "@/db/schema";
import { ApiError, ok } from "@/lib/utils";
import { getEnv } from "@/lib/env";
import {
  getValidAccessToken,
  GOOGLE_SCOPE,
} from "@/lib/google-oauth";
import {
  calendarListEvents,
  calendarCreateEvent,
  calendarUpdateEvent,
  calendarDeleteEvent,
} from "@/lib/google-api";
import {
  parseSchedulingText,
  checkAvailability,
  suggestAlternativeSlots,
  detectMeetingRequest,
} from "@/lib/scheduler";
import { logAction, AuditAction } from "@/lib/audit";

const calendarCrmRoute = new Hono<AppBindings>();

// --- Zod schemas ---

const parseScheduleSchema = z.object({
  text: z.string().min(1),
});

const checkAvailabilitySchema = z.object({
  start: z.string().datetime(),
  end: z.string().datetime(),
  participantEmails: z.array(z.string().email()).max(20).optional(),
}).refine((value) => new Date(value.end) > new Date(value.start), {
  message: "End time must be after start time",
  path: ["end"],
});

const suggestSlotsSchema = z.object({
  start: z.string().datetime(),
  durationMinutes: z.number().int().min(15).max(480).default(30),
  timezone: z.string().optional(),
  participantEmails: z.array(z.string().email()).max(20).optional(),
});

const createEventSchema = z.object({
  title: z.string().min(1).max(300),
  start: z.string().datetime(),
  end: z.string().datetime(),
  attendees: z.array(z.object({ email: z.string().email() })).max(50).optional(),
  description: z.string().max(5000).optional(),
  location: z.string().max(500).optional(),
  addMeetLink: z.boolean().optional(),
  sourceThreadId: z.string().uuid().optional(),
  confirmed: z.literal(true),
  allowOutsideWorkingHours: z.boolean().optional(),
}).refine((value) => new Date(value.end) > new Date(value.start), {
  message: "End time must be after start time",
  path: ["end"],
});

const updateEventSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(5000).optional(),
  location: z.string().max(500).optional(),
  start: z.string().datetime().optional(),
  end: z.string().datetime().optional(),
  attendees: z.array(z.object({ email: z.string().email() })).max(50).optional(),
  confirmed: z.literal(true),
});

const cancelEventSchema = z.object({ confirmed: z.literal(true) });

// --- GET /events — list upcoming Google Calendar events ---

calendarCrmRoute.get("/events", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const userId = c.get("userId");

  const accessToken = await getValidAccessToken(db, env, userId, [
    GOOGLE_SCOPE.CALENDAR_EVENTS,
  ]);
  const now = new Date();
  const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const events = await calendarListEvents(
    accessToken,
    now.toISOString(),
    weekFromNow.toISOString(),
  );

  // Also return CRM bookings
  const bookings = await db
    .select()
    .from(calendarBookings)
    .where(eq(calendarBookings.userId, userId));

  return c.json(ok({ events, bookings }));
});

// --- POST /parse-schedule — parse natural-language scheduling text ---

calendarCrmRoute.post("/parse-schedule", async (c) => {
  const user = c.get("user");
  const { text } = parseScheduleSchema.parse(await c.req.json());

  const parsed = parseSchedulingText(text, user.timezone);

  if (!parsed) {
    // Check if it's a meeting request at all
    const hasMeetingIntent = detectMeetingRequest(text);
    return c.json(
      ok({
        detected: hasMeetingIntent,
        parsed: null,
        message: hasMeetingIntent
          ? "Meeting intent detected, but no specific date/time found."
          : "No scheduling information detected.",
      }),
    );
  }

  return c.json(ok({ detected: true, parsed }));
});

// --- POST /check-availability — check if a time slot is available ---

calendarCrmRoute.post("/check-availability", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const user = c.get("user");
  const { start, end, participantEmails } = checkAvailabilitySchema.parse(
    await c.req.json(),
  );

  const accessToken = await getValidAccessToken(
    db,
    env,
    userIdFromContext(c),
    [GOOGLE_SCOPE.CALENDAR_AVAILABILITY],
  );
  const result = await checkAvailability(
    accessToken,
    start,
    end,
    user.timezone,
    {
      start: user.workingHoursStart,
      end: user.workingHoursEnd,
    },
    participantEmails,
  );

  return c.json(ok(result));
});

// --- POST /suggest-slots — suggest alternative available time slots ---

calendarCrmRoute.post("/suggest-slots", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const user = c.get("user");
  const { start, durationMinutes, participantEmails } =
    suggestSlotsSchema.parse(await c.req.json());

  const accessToken = await getValidAccessToken(
    db,
    env,
    userIdFromContext(c),
    [GOOGLE_SCOPE.CALENDAR_AVAILABILITY],
  );
  const slots = await suggestAlternativeSlots(
    accessToken,
    start,
    durationMinutes,
    user.timezone,
    {
      start: user.workingHoursStart,
      end: user.workingHoursEnd,
    },
    5,
    participantEmails,
  );

  return c.json(ok({ slots }));
});

// --- POST /events — create calendar event (requires explicit confirmation) ---

calendarCrmRoute.post("/events", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const userId = c.get("userId");
  const input = createEventSchema.parse(await c.req.json());

  // Duplicate prevention: check for existing booking with overlapping time
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

  // Re-check Google immediately before creation to avoid a race between slot
  // recommendation and the user's confirmation.
  const accessToken = await getValidAccessToken(db, env, userId, [
    GOOGLE_SCOPE.CALENDAR_EVENTS,
    GOOGLE_SCOPE.CALENDAR_AVAILABILITY,
  ]);
  const availability = await checkAvailability(
    accessToken,
    input.start,
    input.end,
    c.get("user").timezone,
    {
      start: c.get("user").workingHoursStart,
      end: c.get("user").workingHoursEnd,
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

  // Create via Google Calendar only after confirmed=true was validated.
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

  // Store in DB for tracking
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

  // Audit log
  await logAction(db, userId, AuditAction.CALENDAR_CREATE, "calendar_booking", booking.id, {
    title: input.title,
    start: input.start,
    end: input.end,
    googleEventId: result.id,
    meetLink: result.hangoutLink,
  });

  return c.json(ok({ booking, googleEventId: result.id, htmlLink: result.htmlLink }));
});

// --- PATCH /events/:id — update calendar event ---

calendarCrmRoute.patch("/events/:id", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const userId = c.get("userId");
  const bookingId = c.req.param("id");
  const updates = updateEventSchema.parse(await c.req.json());

  const [booking] = await db
    .select()
    .from(calendarBookings)
    .where(
      and(
        eq(calendarBookings.userId, userId),
        eq(calendarBookings.id, bookingId),
      ),
    );

  if (!booking || !booking.googleEventId) {
    throw ApiError.notFound("Booking not found or not linked to Google Calendar");
  }

  // Update via Google Calendar API
  const resultingStart = new Date(updates.start ?? booking.startAt);
  const resultingEnd = new Date(updates.end ?? booking.endAt);
  if (resultingEnd <= resultingStart) {
    throw ApiError.badRequest("End time must be after start time");
  }

  const accessToken = await getValidAccessToken(db, env, userId, [
    GOOGLE_SCOPE.CALENDAR_EVENTS,
  ]);
  if (updates.start || updates.end) {
    const crmConflicts = await db
      .select()
      .from(calendarBookings)
      .where(
        and(
          eq(calendarBookings.userId, userId),
          eq(calendarBookings.status, "confirmed"),
          ne(calendarBookings.id, bookingId),
          sql`${calendarBookings.startAt} < ${resultingEnd.toISOString()}`,
          sql`${calendarBookings.endAt} > ${resultingStart.toISOString()}`,
        ),
      );
    const googleConflicts = (
      await calendarListEvents(
        accessToken,
        resultingStart.toISOString(),
        resultingEnd.toISOString(),
      )
    ).filter((event) => event.id !== booking.googleEventId);
    if (crmConflicts.length > 0 || googleConflicts.length > 0) {
      throw ApiError.conflict(
        "The updated time overlaps another calendar event",
        {
          crmBookingIds: crmConflicts.map((item) => item.id),
          googleEventIds: googleConflicts.map((item) => item.id),
        },
      );
    }
  }
  await calendarUpdateEvent(accessToken, booking.googleEventId, {
    summary: updates.title,
    description: updates.description,
    location: updates.location,
    start: updates.start,
    end: updates.end,
    attendees: updates.attendees,
  });

  // Update DB
  const [updated] = await db
    .update(calendarBookings)
    .set({
      ...(updates.title && { title: updates.title }),
      ...(updates.description !== undefined && { description: updates.description }),
      ...(updates.location !== undefined && { location: updates.location }),
      ...(updates.start && { startAt: new Date(updates.start) }),
      ...(updates.end && { endAt: new Date(updates.end) }),
      ...(updates.attendees && { attendees: updates.attendees }),
    })
    .where(eq(calendarBookings.id, bookingId))
    .returning();

  await logAction(db, userId, AuditAction.CALENDAR_UPDATE, "calendar_booking", bookingId, {
    title: updates.title,
  });

  return c.json(ok({ booking: updated }));
});

// --- DELETE /events/:id — cancel calendar event ---

calendarCrmRoute.delete("/events/:id", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const userId = c.get("userId");
  const bookingId = c.req.param("id");
  cancelEventSchema.parse(await c.req.json());

  const [booking] = await db
    .select()
    .from(calendarBookings)
    .where(
      and(
        eq(calendarBookings.userId, userId),
        eq(calendarBookings.id, bookingId),
      ),
    );

  if (!booking) {
    throw ApiError.notFound("Booking not found");
  }

  // Delete from Google Calendar
  if (booking.googleEventId) {
    const accessToken = await getValidAccessToken(db, env, userId, [
      GOOGLE_SCOPE.CALENDAR_EVENTS,
    ]);
    await calendarDeleteEvent(accessToken, booking.googleEventId);
  }

  // Mark as cancelled in DB
  await db
    .update(calendarBookings)
    .set({ status: "cancelled" })
    .where(eq(calendarBookings.id, bookingId));

  await logAction(db, userId, AuditAction.CALENDAR_CANCEL, "calendar_booking", bookingId, {
    title: booking.title,
  });

  return c.json(ok({ cancelled: true }));
});

// --- Helper ---

function userIdFromContext(c: { get: (key: string) => string }): string {
  return c.get("userId");
}

export default calendarCrmRoute;
