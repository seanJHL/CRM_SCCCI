import { Hono, type Context } from "hono";
import { z } from "zod";
import { eq, gte, lte, and, asc, or, isNull } from "drizzle-orm";
import type { AppBindings } from "@/types";
import { createDatabase } from "@/db";
import {
  events,
  eventCompletions,
  eventExercises,
  exercises,
  calendarBookings,
} from "@/db/schema";
import { ApiError, ok } from "@/lib/utils";
import { getEnv } from "@/lib/env";
import { readSessionCookie, getAuthUser } from "@/lib/session";
import { getValidAccessToken, GOOGLE_SCOPE } from "@/lib/google-oauth";
import { calendarDeleteEvent, calendarUpdateEvent } from "@/lib/google-api";
import { syncCrmBookingsToEmberCalendar } from "@/lib/calendar-sync";
import { logAction, AuditAction } from "@/lib/audit";
import type { AuthUser } from "@/types";

const exerciseItemSchema = z.object({
  exerciseId: z.string().uuid(),
  sets: z.number().int().min(1).max(99).optional().default(3),
  reps: z.number().int().min(1).max(999).optional().default(10),
  weight: z.number().nullable().optional(),
});

const eventSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(5000).optional().or(z.literal("")),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  isAllDay: z.boolean().optional(),
  color: z.string().max(50).optional().or(z.literal("")),
  recurrenceRule: z.string().max(500).optional().or(z.literal("")),
  recurrenceExpiryAt: z.string().datetime().optional().or(z.literal("")),
  isOptional: z.boolean().optional(),
  category: z
    .enum(["meeting", "shift", "personal", "deadline"])
    .optional(),
  tags: z.string().max(1000).optional().or(z.literal("")),
  link: z.string().url().max(2000).optional().or(z.literal("")),
  exercises: z.array(exerciseItemSchema).max(8).optional(),
});

const eventUpdateSchema = eventSchema.partial();

const eventsRoute = new Hono<AppBindings>();

async function getOptionalAuthUser(
  c: Context<AppBindings>,
  db: ReturnType<typeof createDatabase>,
  sessionSecret: string,
): Promise<AuthUser | null> {
  const token = readSessionCookie(c);
  if (!token) return null;
  return getAuthUser(db, token, sessionSecret);
}

async function assertEventAccess(
  c: Context<AppBindings>,
  db: ReturnType<typeof createDatabase>,
  sessionSecret: string,
  ownerUserId: string | null,
): Promise<AuthUser | null> {
  const user = await getOptionalAuthUser(c, db, sessionSecret);
  if (ownerUserId && user?.id !== ownerUserId) {
    throw ApiError.unauthorized("Sign in to access this calendar meeting");
  }
  return user;
}

async function getEventCompletions(
  db: ReturnType<typeof createDatabase>,
  eventId: string,
) {
  return db
    .select()
    .from(eventCompletions)
    .where(eq(eventCompletions.eventId, eventId))
    .orderBy(asc(eventCompletions.occurrenceStart));
}

// Fetch exercises for a given event
async function getEventExercises(
  db: ReturnType<typeof createDatabase>,
  eventId: string,
) {
  const rows = await db
    .select({
      id: eventExercises.id,
      exerciseId: eventExercises.exerciseId,
      exerciseName: exercises.name,
      exerciseCategory: exercises.category,
      sets: eventExercises.sets,
      reps: eventExercises.reps,
      weight: eventExercises.weight,
      position: eventExercises.position,
    })
    .from(eventExercises)
    .innerJoin(exercises, eq(eventExercises.exerciseId, exercises.id))
    .where(eq(eventExercises.eventId, eventId))
    .orderBy(asc(eventExercises.position));
  return rows;
}

// Insert exercises for a given event
async function insertEventExercises(
  db: ReturnType<typeof createDatabase>,
  eventId: string,
  items: Array<{ exerciseId: string; sets?: number; reps?: number; weight?: number | null }>,
) {
  if (items.length === 0) return;
  const values = items.map((item, idx) => ({
    eventId,
    exerciseId: item.exerciseId,
    sets: item.sets ?? 3,
    reps: item.reps ?? 10,
    weight: item.weight ?? null,
    position: idx,
  }));
  await db.insert(eventExercises).values(values);
}

// List events within a date range
eventsRoute.get("/", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const from = c.req.query("from");
  const to = c.req.query("to");
  const user = await getOptionalAuthUser(c, db, env.sessionSecret);

  if (user) {
    await syncCrmBookingsToEmberCalendar(db, user.id);
  }

  let query = db.select().from(events);
  const visibleToUser = user
    ? or(isNull(events.ownerUserId), eq(events.ownerUserId, user.id))
    : isNull(events.ownerUserId);

  if (from && to) {
    const rangeStart = new Date(from);
    const rangeEnd = new Date(to);
    query = query.where(
      and(
        visibleToUser,
        or(
        // One-off and long-running events that overlap the requested range.
          and(
            lte(events.startAt, rangeEnd),
            gte(events.endAt, rangeStart),
          ),
          // A recurring series may begin before the visible range. Return the
          // source event so the client can expand the occurrences it needs.
          and(
            eq(events.recurrenceStatus, "active"),
            lte(events.startAt, rangeEnd),
            gte(events.recurrenceExpiryAt, rangeStart),
          ),
        ),
      ),
    ) as typeof query;
  } else {
    query = query.where(visibleToUser) as typeof query;
  }

  const rows = await query.orderBy(events.startAt);

  // Attach exercises for each event
  const result = await Promise.all(
    rows.map(async (event) => ({
      ...event,
      exercises: await getEventExercises(db, event.id),
      completions: await getEventCompletions(db, event.id),
    })),
  );
  return c.json(ok(result));
});

// Get a single event
eventsRoute.get("/:id", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const id = c.req.param("id");
  const [row] = await db.select().from(events).where(eq(events.id, id));
  if (!row) throw ApiError.notFound(`Event ${id} not found`);
  await assertEventAccess(c, db, env.sessionSecret, row.ownerUserId);
  const exs = await getEventExercises(db, id);
  const completions = await getEventCompletions(db, id);
  return c.json(ok({ ...row, exercises: exs, completions }));
});

// Create an event
eventsRoute.post("/", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const body = eventSchema.parse(await c.req.json());

  // If recurring, require expiry date
  if (body.recurrenceRule && !body.recurrenceExpiryAt) {
    throw ApiError.badRequest(
      "Recurring events must have a recurrence expiry date",
    );
  }

  const [created] = await db
    .insert(events)
    .values({
      title: body.title,
      description: body.description || null,
      startAt: new Date(body.startAt),
      endAt: new Date(body.endAt),
      isAllDay: body.isAllDay ?? false,
      color: body.color || null,
      recurrenceRule: body.recurrenceRule || null,
      recurrenceExpiryAt: body.recurrenceExpiryAt
        ? new Date(body.recurrenceExpiryAt)
        : null,
      recurrenceStatus: body.recurrenceRule ? "active" : "none",
      isOptional: body.isOptional ?? false,
      category: body.category ?? "meeting",
      tags: body.tags || null,
      link: body.link || null,
    })
    .returning();

  // Attach exercises if provided
  if (body.exercises && body.exercises.length > 0) {
    await insertEventExercises(db, created.id, body.exercises);
  }

  const exs = await getEventExercises(db, created.id);
  return c.json(
    ok({ ...created, exercises: exs, completions: [] }, "Event created"),
    201,
  );
});

// Update an event
eventsRoute.patch("/:id", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const id = c.req.param("id");
  const body = eventUpdateSchema.parse(await c.req.json());
  const [existingEvent] = await db
    .select()
    .from(events)
    .where(eq(events.id, id));
  if (!existingEvent) throw ApiError.notFound(`Event ${id} not found`);

  const owner = await assertEventAccess(
    c,
    db,
    env.sessionSecret,
    existingEvent.ownerUserId,
  );

  if (existingEvent.source === "google_crm") {
    if (!owner || !existingEvent.crmBookingId || !existingEvent.googleEventId) {
      throw ApiError.unauthorized("Sign in to update this Google Calendar meeting");
    }
    const [booking] = await db
      .select()
      .from(calendarBookings)
      .where(
        and(
          eq(calendarBookings.id, existingEvent.crmBookingId),
          eq(calendarBookings.userId, owner.id),
        ),
      );
    if (!booking) throw ApiError.notFound("CRM booking not found");

    const accessToken = await getValidAccessToken(db, env, owner.id, [
      GOOGLE_SCOPE.CALENDAR_EVENTS,
    ]);
    await calendarUpdateEvent(accessToken, existingEvent.googleEventId, {
      summary: body.title,
      description: body.description,
      start: body.startAt,
      end: body.endAt,
    });

    await db
      .update(calendarBookings)
      .set({
        ...(body.title !== undefined && { title: body.title }),
        ...(body.description !== undefined && {
          description: body.description || null,
        }),
        ...(body.startAt !== undefined && { startAt: new Date(body.startAt) }),
        ...(body.endAt !== undefined && { endAt: new Date(body.endAt) }),
      })
      .where(eq(calendarBookings.id, booking.id));
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (body.title !== undefined) updates.title = body.title;
  if (body.description !== undefined)
    updates.description = body.description || null;
  if (body.startAt !== undefined) {
    updates.startAt = new Date(body.startAt);
    updates.lastNotifiedAt = null;
  }
  if (body.endAt !== undefined) updates.endAt = new Date(body.endAt);
  if (body.isAllDay !== undefined) updates.isAllDay = body.isAllDay;
  if (body.color !== undefined) updates.color = body.color || null;
  if (body.recurrenceRule !== undefined)
    updates.recurrenceRule = body.recurrenceRule || null;
  if (body.recurrenceExpiryAt !== undefined)
    updates.recurrenceExpiryAt = body.recurrenceExpiryAt
      ? new Date(body.recurrenceExpiryAt)
      : null;
  if (body.isOptional !== undefined) updates.isOptional = body.isOptional;
  if (body.category !== undefined) updates.category = body.category;
  if (body.tags !== undefined) updates.tags = body.tags || null;
  if (body.link !== undefined) updates.link = body.link || null;

  // If recurrence rule was set/cleared, update status accordingly
  if (body.recurrenceRule !== undefined) {
    updates.recurrenceStatus = body.recurrenceRule ? "active" : "none";
  }

  const [updated] = await db
    .update(events)
    .set(updates)
    .where(eq(events.id, id))
    .returning();
  if (!updated) throw ApiError.notFound(`Event ${id} not found`);

  if (existingEvent.source === "google_crm" && owner) {
    await logAction(
      db,
      owner.id,
      AuditAction.CALENDAR_UPDATE,
      "calendar_booking",
      existingEvent.crmBookingId,
      { title: body.title, start: body.startAt, end: body.endAt },
    );
  }

  // Replace exercises if provided in the update
  if (body.exercises !== undefined) {
    await db.delete(eventExercises).where(eq(eventExercises.eventId, id));
    if (body.exercises.length > 0) {
      await insertEventExercises(db, id, body.exercises);
    }
  }

  const exs = await getEventExercises(db, id);
  const completions = await getEventCompletions(db, id);
  return c.json(ok({ ...updated, exercises: exs, completions }, "Event updated"));
});

// Toggle one concrete occurrence. Recurring series therefore retain an
// independent done state for every date on which they appear.
eventsRoute.post("/:id/completions/toggle", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const eventId = c.req.param("id");
  const body = z
    .object({ occurrenceStart: z.string().datetime() })
    .parse(await c.req.json());
  const occurrenceStart = new Date(body.occurrenceStart);

  const [event] = await db
    .select({ id: events.id })
    .from(events)
    .where(eq(events.id, eventId));
  if (!event) throw ApiError.notFound(`Event ${eventId} not found`);

  const [existing] = await db
    .select()
    .from(eventCompletions)
    .where(
      and(
        eq(eventCompletions.eventId, eventId),
        eq(eventCompletions.occurrenceStart, occurrenceStart),
      ),
    );

  if (existing) {
    await db
      .delete(eventCompletions)
      .where(eq(eventCompletions.id, existing.id));
    return c.json(ok({ completed: false }, "Event occurrence reopened"));
  }

  const [completion] = await db
    .insert(eventCompletions)
    .values({ eventId, occurrenceStart })
    .returning();
  return c.json(ok({ completed: true, completion }, "Event occurrence completed"), 201);
});

// Delete an event
eventsRoute.delete("/:id", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const id = c.req.param("id");
  const confirmation = z
    .object({ confirmed: z.boolean().optional() })
    .parse(await c.req.json().catch(() => ({})));
  const [existingEvent] = await db
    .select()
    .from(events)
    .where(eq(events.id, id));
  if (!existingEvent) throw ApiError.notFound(`Event ${id} not found`);

  const owner = await assertEventAccess(
    c,
    db,
    env.sessionSecret,
    existingEvent.ownerUserId,
  );

  if (existingEvent.source === "google_crm") {
    if (!confirmation.confirmed) {
      throw ApiError.badRequest(
        "Explicit confirmation is required to cancel a Google Calendar meeting",
      );
    }
    if (!owner || !existingEvent.crmBookingId || !existingEvent.googleEventId) {
      throw ApiError.unauthorized("Sign in to cancel this Google Calendar meeting");
    }
    const accessToken = await getValidAccessToken(db, env, owner.id, [
      GOOGLE_SCOPE.CALENDAR_EVENTS,
    ]);
    await calendarDeleteEvent(accessToken, existingEvent.googleEventId);
    await db
      .update(calendarBookings)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(calendarBookings.id, existingEvent.crmBookingId),
          eq(calendarBookings.userId, owner.id),
        ),
      );
    await logAction(
      db,
      owner.id,
      AuditAction.CALENDAR_CANCEL,
      "calendar_booking",
      existingEvent.crmBookingId,
      { title: existingEvent.title },
    );
  }

  const [deleted] = await db
    .delete(events)
    .where(eq(events.id, id))
    .returning();
  return c.json(ok(deleted, "Event deleted"));
});

// Recurrence action: keep or kill
eventsRoute.post("/:id/recurrence/:action", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const id = c.req.param("id");
  const action = c.req.param("action"); // "keep" | "kill"

  if (action !== "keep" && action !== "kill") {
    throw ApiError.badRequest("Action must be 'keep' or 'kill'");
  }

  if (action === "kill") {
    const [updated] = await db
      .update(events)
      .set({ recurrenceStatus: "expired", updatedAt: new Date() })
      .where(eq(events.id, id))
      .returning();
    if (!updated) throw ApiError.notFound(`Event ${id} not found`);
    return c.json(ok(updated, "Recurrence killed"));
  }

  // "keep" — extend expiry by 30 days and set back to active
  const [event] = await db
    .select()
    .from(events)
    .where(eq(events.id, id));
  if (!event) throw ApiError.notFound(`Event ${id} not found`);

  const currentExpiry = event.recurrenceExpiryAt ?? new Date();
  const newExpiry = new Date(
    currentExpiry.getTime() + 30 * 24 * 60 * 60 * 1000,
  );

  const [updated] = await db
    .update(events)
    .set({
      recurrenceExpiryAt: newExpiry,
      recurrenceStatus: "active",
      updatedAt: new Date(),
    })
    .where(eq(events.id, id))
    .returning();
  return c.json(ok(updated, "Recurrence extended by 30 days"));
});

export default eventsRoute;
