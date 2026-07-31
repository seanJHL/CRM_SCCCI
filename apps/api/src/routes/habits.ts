import { Hono } from "hono";
import { z } from "zod";
import { eq, gte, lte, and, desc, sql } from "drizzle-orm";
import type { AppBindings } from "@/types";
import { createDatabase } from "@/db";
import { habits, habitCompletions } from "@/db/schema";
import { ApiError, ok } from "@/lib/utils";
import { getEnv } from "@/lib/env";

const habitSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional().or(z.literal("")),
  targetMetric: z.string().max(100).optional().or(z.literal("")),
});

const habitUpdateSchema = habitSchema.partial();

const habitsRoute = new Hono<AppBindings>();

// List all habits
habitsRoute.get("/", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const rows = await db.select().from(habits).orderBy(habits.createdAt);
  return c.json(ok(rows));
});

// Get a single habit with today's completion status
habitsRoute.get("/:id", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const id = c.req.param("id");
  const [row] = await db.select().from(habits).where(eq(habits.id, id));
  if (!row) throw ApiError.notFound(`Habit ${id} not found`);

  // Get today's completions
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  const completions = await db
    .select()
    .from(habitCompletions)
    .where(
      and(
        eq(habitCompletions.habitId, id),
        gte(habitCompletions.completedAt, todayStart),
        lte(habitCompletions.completedAt, todayEnd),
      ),
    );

  return c.json(ok({ ...row, todayCompletions: completions }));
});

// Create a habit
habitsRoute.post("/", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const body = habitSchema.parse(await c.req.json());
  const [created] = await db
    .insert(habits)
    .values({
      name: body.name,
      description: body.description || null,
      targetMetric: body.targetMetric || null,
    })
    .returning();
  return c.json(ok(created, "Habit created"), 201);
});

// Update a habit
habitsRoute.patch("/:id", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const id = c.req.param("id");
  const body = habitUpdateSchema.parse(await c.req.json());

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.description !== undefined)
    updates.description = body.description || null;
  if (body.targetMetric !== undefined)
    updates.targetMetric = body.targetMetric || null;

  const [updated] = await db
    .update(habits)
    .set(updates)
    .where(eq(habits.id, id))
    .returning();
  if (!updated) throw ApiError.notFound(`Habit ${id} not found`);
  return c.json(ok(updated, "Habit updated"));
});

// Delete a habit
habitsRoute.delete("/:id", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const id = c.req.param("id");
  const [deleted] = await db
    .delete(habits)
    .where(eq(habits.id, id))
    .returning();
  if (!deleted) throw ApiError.notFound(`Habit ${id} not found`);
  return c.json(ok(deleted, "Habit deleted"));
});

// Toggle completion for a calendar date (today by default)
habitsRoute.post("/:id/complete", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const id = c.req.param("id");
  const body = z
    .object({
      metricValue: z.string().optional(),
      completedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    })
    .parse(await c.req.json().catch(() => ({})));

  // Toggle the requested calendar date, defaulting to today for existing clients.
  const targetDate = body.completedOn
    ? new Date(`${body.completedOn}T12:00:00.000Z`)
    : new Date();
  const targetStart = new Date(targetDate);
  targetStart.setUTCHours(0, 0, 0, 0);
  const targetEnd = new Date(targetDate);
  targetEnd.setUTCHours(23, 59, 59, 999);
  const todayKey = new Date().toISOString().slice(0, 10);
  const affectsCurrentStreak =
    !body.completedOn || body.completedOn === todayKey;

  const [existing] = await db
    .select()
    .from(habitCompletions)
    .where(
      and(
        eq(habitCompletions.habitId, id),
        gte(habitCompletions.completedAt, targetStart),
        lte(habitCompletions.completedAt, targetEnd),
      ),
    );

  if (existing) {
    // Undo completion
    await db
      .delete(habitCompletions)
      .where(eq(habitCompletions.id, existing.id));
    if (affectsCurrentStreak) {
      await db
        .update(habits)
        .set({ streakCount: sql`GREATEST(${habits.streakCount} - 1, 0)` })
        .where(eq(habits.id, id));
    }
    return c.json(ok(null, "Habit uncompleted"));
  }

  // Create completion
  const [completion] = await db
    .insert(habitCompletions)
    .values({
      habitId: id,
      completedAt: targetDate,
      metricValue: body.metricValue || null,
    })
    .returning();

  if (affectsCurrentStreak) {
    await db
      .update(habits)
      .set({ streakCount: sql`${habits.streakCount} + 1` })
      .where(eq(habits.id, id));
  }

  return c.json(ok(completion, "Habit completed"), 201);
});

// Get completions for a date range
habitsRoute.get("/:id/completions", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const id = c.req.param("id");
  const from = c.req.query("from");
  const to = c.req.query("to");

  const conditions = [eq(habitCompletions.habitId, id)];
  if (from) conditions.push(gte(habitCompletions.completedAt, new Date(from)));
  if (to) conditions.push(lte(habitCompletions.completedAt, new Date(to)));

  const rows = await db
    .select()
    .from(habitCompletions)
    .where(and(...conditions))
    .orderBy(desc(habitCompletions.completedAt));
  return c.json(ok(rows));
});

export default habitsRoute;
