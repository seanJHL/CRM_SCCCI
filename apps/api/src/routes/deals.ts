import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { AppBindings } from "@/types";
import { createDatabase } from "@/db";
import { deals } from "@/db/schema";
import { ApiError, ok } from "@/lib/utils";
import { getEnv } from "@/lib/env";

const dealSchema = z.object({
  companyId: z.string().uuid().optional().nullable(),
  contactId: z.string().uuid().optional().nullable(),
  title: z.string().min(1).max(300),
  status: z.enum(["lead", "qualified", "proposal", "negotiation", "won", "lost"]).optional(),
  value: z.string().max(100).optional().or(z.literal("")),
  notes: z.string().max(5000).optional().or(z.literal("")),
  expectedCloseDate: z.string().datetime().optional().nullable(),
});

const dealUpdateSchema = dealSchema.partial();

const dealsRoute = new Hono<AppBindings>();

// List all deals
dealsRoute.get("/", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const rows = await db.select().from(deals).orderBy(deals.createdAt);
  return c.json(ok(rows));
});

// Get a single deal
dealsRoute.get("/:id", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const id = c.req.param("id");
  const [row] = await db.select().from(deals).where(eq(deals.id, id));
  if (!row) throw ApiError.notFound(`Deal ${id} not found`);
  return c.json(ok(row));
});

// Create a deal
dealsRoute.post("/", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const body = dealSchema.parse(await c.req.json());
  const [created] = await db
    .insert(deals)
    .values({
      ...body,
      value: body.value || null,
      notes: body.notes || null,
      expectedCloseDate: body.expectedCloseDate ? new Date(body.expectedCloseDate) : null,
    })
    .returning();
  return c.json(ok(created, "Deal created"), 201);
});

// Update a deal
dealsRoute.patch("/:id", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const id = c.req.param("id");
  const body = dealUpdateSchema.parse(await c.req.json());
  const [updated] = await db
    .update(deals)
    .set({
      ...body,
      value: body.value || null,
      notes: body.notes || null,
      expectedCloseDate: body.expectedCloseDate ? new Date(body.expectedCloseDate) : undefined,
      updatedAt: new Date(),
    })
    .where(eq(deals.id, id))
    .returning();
  if (!updated) throw ApiError.notFound(`Deal ${id} not found`);
  return c.json(ok(updated, "Deal updated"));
});

// Delete a deal
dealsRoute.delete("/:id", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const id = c.req.param("id");
  const [deleted] = await db.delete(deals).where(eq(deals.id, id)).returning();
  if (!deleted) throw ApiError.notFound(`Deal ${id} not found`);
  return c.json(ok(deleted, "Deal deleted"));
});

export default dealsRoute;
