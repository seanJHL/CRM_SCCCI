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
