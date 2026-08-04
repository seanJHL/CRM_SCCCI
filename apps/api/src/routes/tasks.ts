import { Hono } from "hono";
import { z } from "zod";
import { eq, and, asc } from "drizzle-orm";
import type { AppBindings } from "@/types";
import { createDatabase } from "@/db";
import { tasks, taskItems, type TaskItem } from "@/db/schema";
import { ApiError, ok } from "@/lib/utils";
import { getEnv } from "@/lib/env";

const createTaskSchema = z.object({
  title: z.string().trim().min(1).max(300),
  dueAt: z.string().datetime().optional().or(z.literal("")),
  items: z.array(z.string().trim().min(1).max(300)).min(1).max(50),
});

const tasksRoute = new Hono<AppBindings>();

function isTaskComplete(items: TaskItem[]) {
  return items.length > 0 && items.every((item) => item.completed);
}

function latestCompletion(items: TaskItem[]): Date | null {
  return items.reduce<Date | null>((latest, item) => {
    if (!item.completedAt) return latest;
    return !latest || item.completedAt > latest ? item.completedAt : latest;
  }, null);
}

// List tasks visible for a day range: undated open tasks (always), tasks due
// in range, undated/due-in-range tasks completed within the range (so they
// still show struck-through before rolling off), and incomplete tasks whose
// due date has already passed (carried forward instead of disappearing).
tasksRoute.get("/", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const from = c.req.query("from");
  const to = c.req.query("to");
  const rangeStart = from ? new Date(from) : null;
  const rangeEnd = to ? new Date(to) : null;

  const allTasks = await db.select().from(tasks).orderBy(asc(tasks.dueAt));
  const allItems = await db.select().from(taskItems).orderBy(asc(taskItems.position));

  const itemsByTask = new Map<string, TaskItem[]>();
  for (const item of allItems) {
    const list = itemsByTask.get(item.taskId) ?? [];
    list.push(item);
    itemsByTask.set(item.taskId, list);
  }

  const visible = allTasks.filter((task) => {
    const items = itemsByTask.get(task.id) ?? [];
    const complete = isTaskComplete(items);

    if (!task.dueAt) {
      if (!complete) return true;
      if (!rangeStart || !rangeEnd) return false;
      const completedAt = latestCompletion(items);
      return !!completedAt && completedAt >= rangeStart && completedAt <= rangeEnd;
    }

    if (rangeStart && rangeEnd && task.dueAt >= rangeStart && task.dueAt <= rangeEnd) return true;
    if (rangeStart && task.dueAt < rangeStart && !complete) return true;
    return false;
  });

  const result = visible.map((task) => ({
    ...task,
    items: (itemsByTask.get(task.id) ?? []).sort((a, b) => a.position - b.position),
  }));

  return c.json(ok(result));
});

// Create a task with its checklist items in one call.
tasksRoute.post("/", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const body = createTaskSchema.parse(await c.req.json());

  const [created] = await db
    .insert(tasks)
    .values({
      title: body.title,
      dueAt: body.dueAt ? new Date(body.dueAt) : null,
    })
    .returning();

  const itemValues = body.items.map((label, index) => ({
    taskId: created.id,
    label,
    position: index,
  }));
  const insertedItems = await db.insert(taskItems).values(itemValues).returning();

  return c.json(
    ok({ ...created, items: insertedItems }, "Task created"),
    201,
  );
});

// Toggle a single checklist item's completion.
tasksRoute.post("/:taskId/items/:itemId/toggle", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const taskId = c.req.param("taskId");
  const itemId = c.req.param("itemId");

  const [item] = await db
    .select()
    .from(taskItems)
    .where(and(eq(taskItems.id, itemId), eq(taskItems.taskId, taskId)));
  if (!item) throw ApiError.notFound(`Task item ${itemId} not found`);

  const nextCompleted = !item.completed;
  const [updated] = await db
    .update(taskItems)
    .set({ completed: nextCompleted, completedAt: nextCompleted ? new Date() : null })
    .where(eq(taskItems.id, itemId))
    .returning();

  return c.json(ok(updated, "Task item updated"));
});

// Delete a task and its checklist items (cascades).
tasksRoute.delete("/:id", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const id = c.req.param("id");
  const [deleted] = await db.delete(tasks).where(eq(tasks.id, id)).returning();
  if (!deleted) throw ApiError.notFound(`Task ${id} not found`);
  return c.json(ok(deleted, "Task deleted"));
});

export default tasksRoute;
