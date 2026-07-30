import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { AppBindings } from "@/types";
import { createDatabase } from "@/db";
import { contacts } from "@/db/schema";
import { ApiError, ok } from "@/lib/utils";
import { getEnv } from "@/lib/env";

const contactSchema = z.object({
  companyId: z.string().uuid().optional().nullable(),
  firstName: z.string().min(1).max(200),
  lastName: z.string().min(1).max(200),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().max(50).optional().or(z.literal("")),
  title: z.string().max(200).optional().or(z.literal("")),
  notes: z.string().max(5000).optional().or(z.literal("")),
  isActive: z.boolean().optional(),
});

const contactUpdateSchema = contactSchema.partial();

const contactsRoute = new Hono<AppBindings>();

// List all contacts
contactsRoute.get("/", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const rows = await db.select().from(contacts).orderBy(contacts.createdAt);
  return c.json(ok(rows));
});

// Get a single contact
contactsRoute.get("/:id", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const id = c.req.param("id");
  const [row] = await db.select().from(contacts).where(eq(contacts.id, id));
  if (!row) throw ApiError.notFound(`Contact ${id} not found`);
  return c.json(ok(row));
});

// Create a contact
contactsRoute.post("/", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const body = contactSchema.parse(await c.req.json());
  const [created] = await db
    .insert(contacts)
    .values({
      ...body,
      email: body.email || null,
      phone: body.phone || null,
      title: body.title || null,
      notes: body.notes || null,
    })
    .returning();
  return c.json(ok(created, "Contact created"), 201);
});

// Update a contact
contactsRoute.patch("/:id", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const id = c.req.param("id");
  const body = contactUpdateSchema.parse(await c.req.json());
  const [updated] = await db
    .update(contacts)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(contacts.id, id))
    .returning();
  if (!updated) throw ApiError.notFound(`Contact ${id} not found`);
  return c.json(ok(updated, "Contact updated"));
});

// Delete a contact
contactsRoute.delete("/:id", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const id = c.req.param("id");
  const [deleted] = await db.delete(contacts).where(eq(contacts.id, id)).returning();
  if (!deleted) throw ApiError.notFound(`Contact ${id} not found`);
  return c.json(ok(deleted, "Contact deleted"));
});

export default contactsRoute;
