import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { AppBindings } from "@/types";
import { createDatabase } from "@/db";
import { companies } from "@/db/schema";
import { ApiError, ok } from "@/lib/utils";
import { getEnv } from "@/lib/env";

const companySchema = z.object({
  name: z.string().min(1).max(200),
  website: z.string().url().optional().or(z.literal("")),
  industry: z.string().max(200).optional().or(z.literal("")),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().max(50).optional().or(z.literal("")),
  address: z.string().max(500).optional().or(z.literal("")),
  notes: z.string().max(5000).optional().or(z.literal("")),
  isActive: z.boolean().optional(),
});

const companyUpdateSchema = companySchema.partial();

const companiesRoute = new Hono<AppBindings>();

// List all companies
companiesRoute.get("/", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const rows = await db.select().from(companies).orderBy(companies.createdAt);
  return c.json(ok(rows));
});

// Get a single company
companiesRoute.get("/:id", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const id = c.req.param("id");
  const [row] = await db.select().from(companies).where(eq(companies.id, id));
  if (!row) throw ApiError.notFound(`Company ${id} not found`);
  return c.json(ok(row));
});

// Create a company
companiesRoute.post("/", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const body = companySchema.parse(await c.req.json());
  const [created] = await db
    .insert(companies)
    .values({ ...body, website: body.website || null, industry: body.industry || null, email: body.email || null, phone: body.phone || null, address: body.address || null, notes: body.notes || null })
    .returning();
  return c.json(ok(created, "Company created"), 201);
});

// Update a company
companiesRoute.patch("/:id", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const id = c.req.param("id");
  const body = companyUpdateSchema.parse(await c.req.json());
  const [updated] = await db
    .update(companies)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(companies.id, id))
    .returning();
  if (!updated) throw ApiError.notFound(`Company ${id} not found`);
  return c.json(ok(updated, "Company updated"));
});

// Delete a company
companiesRoute.delete("/:id", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const id = c.req.param("id");
  const [deleted] = await db.delete(companies).where(eq(companies.id, id)).returning();
  if (!deleted) throw ApiError.notFound(`Company ${id} not found`);
  return c.json(ok(deleted, "Company deleted"));
});

export default companiesRoute;
