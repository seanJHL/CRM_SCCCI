import { Hono } from "hono";
import { z } from "zod";
import { eq, gte, lte, and, asc } from "drizzle-orm";
import type { AppBindings } from "@/types";
import { createDatabase } from "@/db";
import { plannerTasks, plannerBlocks, events } from "@/db/schema";
import { ApiError, ok } from "@/lib/utils";
import { getEnv } from "@/lib/env";

const taskSchema = z.object({
  title: z.string().min(1).max(300),
  deadlineAt: z.string().datetime(),
  effortEstimateHours: z.number().min(0.5),
  description: z.string().max(5000).optional().or(z.literal("")),
});

const taskUpdateSchema = taskSchema.partial();

const plannerRoute = new Hono<AppBindings>();

// List all planner tasks
plannerRoute.get("/tasks", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const rows = await db
    .select()
    .from(plannerTasks)
    .orderBy(asc(plannerTasks.deadlineAt));
  return c.json(ok(rows));
});

// Get a task with its blocks
plannerRoute.get("/tasks/:id", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const id = c.req.param("id");

  const [task] = await db
    .select()
    .from(plannerTasks)
    .where(eq(plannerTasks.id, id));
  if (!task) throw ApiError.notFound(`Task ${id} not found`);

  const blocks = await db
    .select()
    .from(plannerBlocks)
    .where(eq(plannerBlocks.taskId, id))
    .orderBy(asc(plannerBlocks.scheduledStart));

  return c.json(ok({ ...task, blocks }));
});

// Create a task and auto-generate blocks
plannerRoute.post("/tasks", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const body = taskSchema.parse(await c.req.json());

  const [task] = await db
    .insert(plannerTasks)
    .values({
      title: body.title,
      deadlineAt: new Date(body.deadlineAt),
      effortEstimateHours: body.effortEstimateHours,
      description: body.description || null,
    })
    .returning();

  // Auto-generate work blocks using backward planning
  const blocks = await generateBlocks(
    db,
    task.id,
    new Date(body.deadlineAt),
    body.effortEstimateHours,
  );

  return c.json(ok({ ...task, blocks }, "Task created with planned blocks"), 201);
});

// Update a task
plannerRoute.patch("/tasks/:id", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const id = c.req.param("id");
  const body = taskUpdateSchema.parse(await c.req.json());

  const updates: Record<string, unknown> = {};
  if (body.title !== undefined) updates.title = body.title;
  if (body.deadlineAt !== undefined)
    updates.deadlineAt = new Date(body.deadlineAt);
  if (body.effortEstimateHours !== undefined)
    updates.effortEstimateHours = body.effortEstimateHours;
  if (body.description !== undefined)
    updates.description = body.description || null;

  const [updated] = await db
    .update(plannerTasks)
    .set(updates)
    .where(eq(plannerTasks.id, id))
    .returning();
  if (!updated) throw ApiError.notFound(`Task ${id} not found`);
  return c.json(ok(updated, "Task updated"));
});

// Re-plan: delete old blocks and regenerate
plannerRoute.post("/tasks/:id/replan", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const id = c.req.param("id");

  const [task] = await db
    .select()
    .from(plannerTasks)
    .where(eq(plannerTasks.id, id));
  if (!task) throw ApiError.notFound(`Task ${id} not found`);

  // Delete existing planned blocks (keep done ones)
  await db
    .delete(plannerBlocks)
    .where(
      and(
        eq(plannerBlocks.taskId, id),
        eq(plannerBlocks.status, "planned"),
      ),
    );

  // Calculate remaining effort
  const doneBlocks = await db
    .select()
    .from(plannerBlocks)
    .where(
      and(eq(plannerBlocks.taskId, id), eq(plannerBlocks.status, "done")),
    );
  const doneHours = doneBlocks.reduce((sum, b) => {
    const hrs =
      (new Date(b.scheduledEnd).getTime() -
        new Date(b.scheduledStart).getTime()) /
      3600000;
    return sum + hrs;
  }, 0);
  const remainingHours = Math.max(0, task.effortEstimateHours - doneHours);

  const blocks = await generateBlocks(
    db,
    task.id,
    new Date(task.deadlineAt),
    remainingHours,
  );

  return c.json(ok(blocks, "Task re-planned"));
});

// Update a block status
plannerRoute.patch("/blocks/:id", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const id = c.req.param("id");
  const body = z
    .object({ status: z.enum(["planned", "done", "skipped"]) })
    .parse(await c.req.json());

  const [updated] = await db
    .update(plannerBlocks)
    .set({ status: body.status })
    .where(eq(plannerBlocks.id, id))
    .returning();
  if (!updated) throw ApiError.notFound(`Block ${id} not found`);
  return c.json(ok(updated, "Block updated"));
});

// Delete a task
plannerRoute.delete("/tasks/:id", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const id = c.req.param("id");
  const [deleted] = await db
    .delete(plannerTasks)
    .where(eq(plannerTasks.id, id))
    .returning();
  if (!deleted) throw ApiError.notFound(`Task ${id} not found`);
  return c.json(ok(deleted, "Task deleted"));
});

// --- Backward Planning Algorithm ---

/**
 * Greedy slot-filler: iterate from deadline backward, find free blocks
 * of 60-90 min in the user's waking hours (8am-10pm), assign until
 * effort is exhausted.
 */
async function generateBlocks(
  db: ReturnType<typeof createDatabase>,
  taskId: string,
  deadline: Date,
  effortHours: number,
) {
  const BLOCK_DURATION_MIN = 90; // 90 min work blocks
  const WAKING_START_HOUR = 8;
  const WAKING_END_HOUR = 22;

  // Fetch all events in the planning window (now to deadline)
  const now = new Date();
  const allEvents = await db
    .select()
    .from(events)
    .where(
      and(gte(events.startAt, now), lte(events.startAt, deadline)),
    );

  // Build a list of busy intervals
  const busyIntervals = allEvents.map((e) => ({
    start: new Date(e.startAt).getTime(),
    end: new Date(e.endAt).getTime(),
  }));

  const blocks: Array<{
    taskId: string;
    scheduledStart: Date;
    scheduledEnd: Date;
    status: "planned";
  }> = [];

  let remainingMinutes = effortHours * 60;

  // Iterate day by day from deadline backward
  const currentDay = new Date(deadline);
  currentDay.setHours(WAKING_END_HOUR, 0, 0, 0);

  while (remainingMinutes > 0 && currentDay.getTime() > now.getTime()) {
    // Try to fit blocks in this day from end to start
    const dayStart = new Date(currentDay);
    dayStart.setHours(WAKING_START_HOUR, 0, 0, 0);

    let slotEnd = currentDay.getTime();

    while (remainingMinutes > 0 && slotEnd - BLOCK_DURATION_MIN * 60000 >= dayStart.getTime()) {
      const slotStart = slotEnd - BLOCK_DURATION_MIN * 60000;

      // Check if this slot conflicts with any busy interval
      const hasConflict = busyIntervals.some(
        (busy) => slotStart < busy.end && slotEnd > busy.start,
      );

      if (!hasConflict) {
        blocks.push({
          taskId,
          scheduledStart: new Date(slotStart),
          scheduledEnd: new Date(slotEnd),
          status: "planned",
        });
        remainingMinutes -= BLOCK_DURATION_MIN;
        // Mark this slot as busy
        busyIntervals.push({ start: slotStart, end: slotEnd });
      }

      // Move to previous slot (with 15 min buffer)
      slotEnd = slotStart - 15 * 60000;
    }

    // Move to previous day
    currentDay.setDate(currentDay.getDate() - 1);
    currentDay.setHours(WAKING_END_HOUR, 0, 0, 0);
  }

  // Insert blocks into DB
  if (blocks.length) {
    await db.insert(plannerBlocks).values(blocks);
  }

  return blocks;
}

export default plannerRoute;
