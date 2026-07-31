import { Hono } from "hono";
import { z } from "zod";
import { eq, gte, lte, and, asc } from "drizzle-orm";
import type { AppBindings } from "@/types";
import { createDatabase } from "@/db";
import { events, eventExercises, exercises } from "@/db/schema";
import { ApiError, ok } from "@/lib/utils";
import { getEnv } from "@/lib/env";

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

  let query = db.select().from(events);

  if (from && to) {
    query = query.where(
      and(
        gte(events.startAt, new Date(from)),
        lte(events.startAt, new Date(to)),
      ),
    ) as typeof query;
  }

  const rows = await query.orderBy(events.startAt);

  // Attach exercises for each event
  const result = await Promise.all(
    rows.map(async (event) => ({
      ...event,
      exercises: await getEventExercises(db, event.id),
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
  const exs = await getEventExercises(db, id);
  return c.json(ok({ ...row, exercises: exs }));
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
  return c.json(ok({ ...created, exercises: exs }, "Event created"), 201);
});

// Update an event
eventsRoute.patch("/:id", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const id = c.req.param("id");
  const body = eventUpdateSchema.parse(await c.req.json());

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (body.title !== undefined) updates.title = body.title;
  if (body.description !== undefined)
    updates.description = body.description || null;
  if (body.startAt !== undefined) updates.startAt = new Date(body.startAt);
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

  // Replace exercises if provided in the update
  if (body.exercises !== undefined) {
    await db.delete(eventExercises).where(eq(eventExercises.eventId, id));
    if (body.exercises.length > 0) {
      await insertEventExercises(db, id, body.exercises);
    }
  }

  const exs = await getEventExercises(db, id);
  return c.json(ok({ ...updated, exercises: exs }, "Event updated"));
});

// Delete an event
eventsRoute.delete("/:id", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const id = c.req.param("id");
  const [deleted] = await db
    .delete(events)
    .where(eq(events.id, id))
    .returning();
  if (!deleted) throw ApiError.notFound(`Event ${id} not found`);
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
