import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { AppBindings } from "@/types";
import { createDatabase } from "@/db";
import { reminders } from "@/db/schema";
import { ApiError, ok } from "@/lib/utils";
import { getEnv } from "@/lib/env";

const timeOfDaySchema = z.string().regex(
  /^(?:[01]\d|2[0-3]):[0-5]\d$/,
  "timeOfDay must be a valid 24-hour HH:mm value",
);

const timeZoneSchema = z.string().min(1).max(100).refine((value) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}, "timeZone must be a valid IANA time zone");

const reminderSchema = z.object({
  name: z.string().min(1).max(200),
  scheduleType: z.enum(["interval", "daily_time"]),
  intervalMinutes: z.number().int().min(1).optional(),
  timeOfDay: timeOfDaySchema.optional(),
  timeZone: timeZoneSchema.optional(),
  isActive: z.boolean().optional(),
});

const reminderUpdateSchema = reminderSchema.partial();

const remindersRoute = new Hono<AppBindings>();

// List all reminders
remindersRoute.get("/", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const rows = await db.select().from(reminders).orderBy(reminders.createdAt);
  return c.json(ok(rows));
});

// Get a single reminder
remindersRoute.get("/:id", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const id = c.req.param("id");
  const [row] = await db.select().from(reminders).where(eq(reminders.id, id));
  if (!row) throw ApiError.notFound(`Reminder ${id} not found`);
  return c.json(ok(row));
});

// Create a reminder
remindersRoute.post("/", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const body = reminderSchema.parse(await c.req.json());

  // Validate based on schedule type
  if (body.scheduleType === "interval" && !body.intervalMinutes) {
    throw ApiError.badRequest("Interval reminders require intervalMinutes");
  }
  if (body.scheduleType === "daily_time" && !body.timeOfDay) {
    throw ApiError.badRequest("Daily time reminders require timeOfDay");
  }

  const [created] = await db
    .insert(reminders)
    .values({
      name: body.name,
      scheduleType: body.scheduleType,
      intervalMinutes: body.intervalMinutes ?? null,
      timeOfDay: body.timeOfDay ?? null,
      timeZone: body.timeZone ?? "Asia/Singapore",
      isActive: body.isActive ?? true,
    })
    .returning();
  return c.json(ok(created, "Reminder created"), 201);
});

// Update a reminder
remindersRoute.patch("/:id", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const id = c.req.param("id");
  const body = reminderUpdateSchema.parse(await c.req.json());

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.scheduleType !== undefined)
    updates.scheduleType = body.scheduleType;
  if (body.intervalMinutes !== undefined)
    updates.intervalMinutes = body.intervalMinutes ?? null;
  if (body.timeOfDay !== undefined)
    updates.timeOfDay = body.timeOfDay ?? null;
  if (body.timeZone !== undefined) updates.timeZone = body.timeZone;
  if (body.isActive !== undefined) updates.isActive = body.isActive;

  const [updated] = await db
    .update(reminders)
    .set(updates)
    .where(eq(reminders.id, id))
    .returning();
  if (!updated) throw ApiError.notFound(`Reminder ${id} not found`);
  return c.json(ok(updated, "Reminder updated"));
});

// Toggle active status
remindersRoute.post("/:id/toggle", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const id = c.req.param("id");

  const [reminder] = await db
    .select()
    .from(reminders)
    .where(eq(reminders.id, id));
  if (!reminder) throw ApiError.notFound(`Reminder ${id} not found`);

  const [updated] = await db
    .update(reminders)
    .set({
      isActive: !reminder.isActive,
      lastFiredAt: reminder.isActive ? reminder.lastFiredAt : null,
    })
    .where(eq(reminders.id, id))
    .returning();
  return c.json(ok(updated, `Reminder ${updated.isActive ? "activated" : "deactivated"}`));
});

// Delete a reminder
remindersRoute.delete("/:id", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const id = c.req.param("id");
  const [deleted] = await db
    .delete(reminders)
    .where(eq(reminders.id, id))
    .returning();
  if (!deleted) throw ApiError.notFound(`Reminder ${id} not found`);
  return c.json(ok(deleted, "Reminder deleted"));
});

export default remindersRoute;
