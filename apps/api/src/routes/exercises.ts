import { Hono } from "hono";
import { z } from "zod";
import { eq, ilike } from "drizzle-orm";
import type { AppBindings } from "@/types";
import { createDatabase } from "@/db";
import { exercises } from "@/db/schema";
import { ApiError, ok } from "@/lib/utils";
import { getEnv } from "@/lib/env";

const exercisesRoute = new Hono<AppBindings>();

const exerciseImageBases = [
  "https://yuhonas.github.io/free-exercise-db/exercises",
  "https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@main/exercises",
  "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises",
] as const;

const exerciseSchema = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.enum([
    "chest",
    "back",
    "legs",
    "shoulders_arms",
    "core",
    "cardio",
    "functional",
    "mobility",
  ]),
  equipmentType: z.enum([
    "machine",
    "free_weight",
    "bodyweight",
    "cardio",
    "outdoor",
    "other",
  ]),
  trackingType: z.enum(["strength", "run"]).default("strength"),
});

// Proxy exercise images through the API so browser privacy/content-blocking
// settings cannot prevent the workout UI from loading third-party assets.
exercisesRoute.get("/images/:directory/:frame", async (c) => {
  const { directory, frame } = z
    .object({
      directory: z.string().regex(/^[A-Za-z0-9_-]+$/),
      frame: z.enum(["0", "1"]),
    })
    .parse(c.req.param());

  for (const base of exerciseImageBases) {
    try {
      const upstream = await fetch(
        `${base}/${encodeURIComponent(directory)}/${frame}.jpg`,
      );
      const contentType = upstream.headers.get("Content-Type");

      if (!upstream.ok || !upstream.body || !contentType?.startsWith("image/")) {
        continue;
      }

      const headers = new Headers({
        "Cache-Control":
          "public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800",
        "Content-Type": contentType,
        "X-Content-Type-Options": "nosniff",
      });
      const contentLength = upstream.headers.get("Content-Length");
      const etag = upstream.headers.get("ETag");
      if (contentLength) headers.set("Content-Length", contentLength);
      if (etag) headers.set("ETag", etag);

      // Pass the upstream stream through instead of buffering the image in the
      // Worker's memory.
      return new Response(upstream.body, { headers });
    } catch {
      // Try the next mirror. A structured 404 is returned if every host fails.
    }
  }

  throw ApiError.notFound("Exercise image not found");
});

// List all exercises, optionally filtered by category or search query
exercisesRoute.get("/", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const category = c.req.query("category");
  const search = c.req.query("search");

  let query = db.select().from(exercises);

  if (category) {
    query = query.where(eq(exercises.category, category)) as typeof query;
  } else if (search) {
    query = query.where(
      ilike(exercises.name, `%${search}%`),
    ) as typeof query;
  }

  const rows = await query.orderBy(exercises.category, exercises.name);

  // The library can be changed by users, so always revalidate the list.
  c.header("Cache-Control", "no-store");
  return c.json(ok(rows));
});

// Add an exercise to the shared library
exercisesRoute.post("/", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const body = exerciseSchema.parse(await c.req.json());

  const [existing] = await db
    .select()
    .from(exercises)
    .where(ilike(exercises.name, body.name))
    .limit(1);

  if (existing) {
    throw new ApiError(
      409,
      "EXERCISE_EXISTS",
      `An exercise named "${existing.name}" already exists`,
      { exercise: existing },
    );
  }

  const [created] = await db
    .insert(exercises)
    .values(body)
    .returning();

  return c.json(ok(created, "Exercise created"), 201);
});

// Get a single exercise
exercisesRoute.get("/:id", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const id = c.req.param("id");
  const [row] = await db.select().from(exercises).where(eq(exercises.id, id));
  if (!row) {
    return c.json({ success: false, error: { code: "NOT_FOUND", message: `Exercise ${id} not found` } }, 404);
  }
  return c.json(ok(row));
});

export default exercisesRoute;
