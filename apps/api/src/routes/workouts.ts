import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { AppBindings } from "@/types";
import { createDatabase } from "@/db";
import {
  workoutGroups,
  groupExercises,
  workoutSessions,
  sessionExerciseLogs,
  sessionSets,
  exercises,
} from "@/db/schema";
import { ApiError, ok } from "@/lib/utils";
import { getEnv } from "@/lib/env";

// --- Schemas ---

const groupSchema = z.object({
  name: z.string().min(1).max(200),
  targetDays: z.string().max(100).nullable().optional().or(z.literal("")),
  exercises: z
    .array(
      z.object({
        exerciseId: z.string().uuid(),
        position: z.number().int(),
        defaultSets: z.number().int().min(1).default(3),
        defaultReps: z.number().int().min(1).default(10),
        defaultWeight: z.number().optional(),
        defaultDistanceKm: z.number().min(0).max(1_000).optional(),
        defaultDurationMinutes: z.number().int().min(1).max(10_000).optional(),
      }),
    )
    .optional(),
});

const groupUpdateSchema = groupSchema.partial();

const setLogSchema = z.object({
  weight: z.number().optional(),
  reps: z.number().int().optional(),
  distanceKm: z.number().min(0).max(1_000).optional(),
  durationMinutes: z.number().int().min(1).max(10_000).optional(),
});

const workoutsRoute = new Hono<AppBindings>();

async function getExercisePerformance(
  db: ReturnType<typeof createDatabase>,
  exerciseIds: string[],
) {
  if (exerciseIds.length === 0) return [];

  const rows = await db
    .select({
      exerciseId: sessionExerciseLogs.exerciseId,
      sessionId: workoutSessions.id,
      performedAt: workoutSessions.startedAt,
      sessionStatus: workoutSessions.status,
      setNumber: sessionSets.setNumber,
      weight: sessionSets.weight,
      reps: sessionSets.reps,
      distanceKm: sessionSets.distanceKm,
      durationMinutes: sessionSets.durationMinutes,
      completedAt: sessionSets.completedAt,
    })
    .from(sessionExerciseLogs)
    .innerJoin(
      workoutSessions,
      eq(sessionExerciseLogs.sessionId, workoutSessions.id),
    )
    .leftJoin(
      sessionSets,
      eq(sessionSets.sessionExerciseLogId, sessionExerciseLogs.id),
    )
    .where(inArray(sessionExerciseLogs.exerciseId, exerciseIds))
    .orderBy(desc(workoutSessions.startedAt), sessionSets.setNumber);

  return exerciseIds.map((exerciseId) => {
    const completedRows = rows.filter(
      (row) => row.exerciseId === exerciseId && row.completedAt !== null,
    );
    const weightedRows = completedRows.filter((row) => row.weight !== null);
    const maxWeight =
      weightedRows.length > 0
        ? Math.max(...weightedRows.map((row) => row.weight ?? 0))
        : null;
    const repRows = completedRows.filter((row) => row.reps !== null);
    const maxReps =
      repRows.length > 0
        ? Math.max(...repRows.map((row) => row.reps ?? 0))
        : null;
    const distanceRows = completedRows.filter(
      (row) => (row.distanceKm ?? 0) > 0,
    );
    const maxDistanceKm =
      distanceRows.length > 0
        ? Math.max(...distanceRows.map((row) => row.distanceKm ?? 0))
        : null;
    const paceRows = distanceRows.filter(
      (row) => (row.durationMinutes ?? 0) > 0,
    );
    const fastestPaceMinPerKm =
      paceRows.length > 0
        ? Math.min(
            ...paceRows.map(
              (row) => (row.durationMinutes ?? 0) / (row.distanceKm ?? 1),
            ),
          )
        : null;
    const bestRow = completedRows.reduce<(typeof completedRows)[number] | null>(
      (best, row) => {
        if (!best) return row;
        const rowScore =
          (row.weight ?? 0) > 0
            ? (row.weight ?? 0) * (1 + (row.reps ?? 0) / 30)
            : (row.reps ?? 0);
        const bestScore =
          (best.weight ?? 0) > 0
            ? (best.weight ?? 0) * (1 + (best.reps ?? 0) / 30)
            : (best.reps ?? 0);
        return rowScore > bestScore ? row : best;
      },
      null,
    );

    const previousCompletedSessionId = completedRows.find(
      (row) => row.sessionStatus === "completed",
    )?.sessionId;
    const previousSessionId =
      previousCompletedSessionId ?? completedRows[0]?.sessionId;
    const previousRows = previousSessionId
      ? completedRows.filter((row) => row.sessionId === previousSessionId)
      : [];

    return {
      exerciseId,
      maxWeight,
      maxReps,
      maxDistanceKm,
      fastestPaceMinPerKm,
      bestSet: bestRow
        ? {
            weight: bestRow.weight,
            reps: bestRow.reps,
            distanceKm: bestRow.distanceKm,
            durationMinutes: bestRow.durationMinutes,
            estimatedOneRepMax:
              (bestRow.weight ?? 0) > 0
                ? Math.round(
                    (bestRow.weight ?? 0) *
                      (1 + (bestRow.reps ?? 0) / 30) *
                      10,
                  ) / 10
                : null,
          }
        : null,
      previousWorkout:
        previousRows.length > 0
          ? {
              sessionId: previousRows[0].sessionId,
              performedAt: previousRows[0].performedAt,
              sets: previousRows.map((row) => ({
                setNumber: row.setNumber ?? 0,
                weight: row.weight,
                reps: row.reps,
                distanceKm: row.distanceKm,
                durationMinutes: row.durationMinutes,
              })),
            }
          : null,
    };
  });
}

// --- Workout Groups ---

workoutsRoute.get("/performance", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const requestedIds = (c.req.query("exerciseIds") ?? "")
    .split(",")
    .filter(Boolean)
    .slice(0, 100);
  const exerciseIds = requestedIds.filter(
    (id) => z.string().uuid().safeParse(id).success,
  );

  return c.json(ok(await getExercisePerformance(db, exerciseIds)));
});

// List all groups
workoutsRoute.get("/groups", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const rows = await db
    .select()
    .from(workoutGroups)
    .where(eq(workoutGroups.status, "active"))
    .orderBy(desc(workoutGroups.createdAt));
  c.header("Cache-Control", "private, max-age=60");
  return c.json(ok(rows));
});

// Get a single group with its exercises
workoutsRoute.get("/groups/:id", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const id = c.req.param("id");

  const [group] = await db
    .select()
    .from(workoutGroups)
    .where(eq(workoutGroups.id, id));
  if (!group) throw ApiError.notFound(`Group ${id} not found`);

  const groupExs = await db
    .select({
      id: groupExercises.id,
      position: groupExercises.position,
      defaultSets: groupExercises.defaultSets,
      defaultReps: groupExercises.defaultReps,
      defaultWeight: groupExercises.defaultWeight,
      exerciseId: exercises.id,
      exerciseName: exercises.name,
      exerciseCategory: exercises.category,
      equipmentType: exercises.equipmentType,
      trackingType: exercises.trackingType,
      defaultDistanceKm: groupExercises.defaultDistanceKm,
      defaultDurationMinutes: groupExercises.defaultDurationMinutes,
    })
    .from(groupExercises)
    .innerJoin(exercises, eq(groupExercises.exerciseId, exercises.id))
    .where(eq(groupExercises.groupId, id))
    .orderBy(groupExercises.position);

  const performance = await getExercisePerformance(
    db,
    groupExs.map((exercise) => exercise.exerciseId),
  );

  return c.json(
    ok({
      ...group,
      exercises: groupExs.map((exercise) => ({
        ...exercise,
        performance:
          performance.find(
            (item) => item.exerciseId === exercise.exerciseId,
          ) ?? null,
      })),
    }),
  );
});

// Create a group
workoutsRoute.post("/groups", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const body = groupSchema.parse(await c.req.json());

  const [created] = await db
    .insert(workoutGroups)
    .values({
      name: body.name,
      targetDays: body.targetDays || null,
    })
    .returning();

  // Add exercises if provided
  if (body.exercises?.length) {
    await db.insert(groupExercises).values(
      body.exercises.map((ex) => ({
        groupId: created.id,
        exerciseId: ex.exerciseId,
        position: ex.position,
        defaultSets: ex.defaultSets,
        defaultReps: ex.defaultReps,
        defaultWeight: ex.defaultWeight ?? null,
        defaultDistanceKm: ex.defaultDistanceKm ?? null,
        defaultDurationMinutes: ex.defaultDurationMinutes ?? null,
      })),
    );
  }

  return c.json(ok(created, "Group created"), 201);
});

// Update a group
workoutsRoute.patch("/groups/:id", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const id = c.req.param("id");
  const body = groupUpdateSchema.parse(await c.req.json());

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (body.name !== undefined) updates.name = body.name;
  if (body.targetDays !== undefined)
    updates.targetDays = body.targetDays || null;
  if (body.exercises !== undefined) {
    // Replace all exercises
    await db
      .delete(groupExercises)
      .where(eq(groupExercises.groupId, id));
    if (body.exercises.length) {
      await db.insert(groupExercises).values(
        body.exercises.map((ex) => ({
          groupId: id,
          exerciseId: ex.exerciseId,
          position: ex.position,
          defaultSets: ex.defaultSets,
          defaultReps: ex.defaultReps,
          defaultWeight: ex.defaultWeight ?? null,
          defaultDistanceKm: ex.defaultDistanceKm ?? null,
          defaultDurationMinutes: ex.defaultDurationMinutes ?? null,
        })),
      );
    }
  }

  const [updated] = await db
    .update(workoutGroups)
    .set(updates)
    .where(eq(workoutGroups.id, id))
    .returning();
  if (!updated) throw ApiError.notFound(`Group ${id} not found`);
  return c.json(ok(updated, "Group updated"));
});

// Delete a group
workoutsRoute.delete("/groups/:id", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const id = c.req.param("id");
  const [deleted] = await db
    .delete(workoutGroups)
    .where(eq(workoutGroups.id, id))
    .returning();
  if (!deleted) throw ApiError.notFound(`Group ${id} not found`);
  return c.json(ok(deleted, "Group deleted"));
});

// --- Workout Sessions ---

// Start a new session for a group
workoutsRoute.post("/sessions/start/:groupId", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const groupId = c.req.param("groupId");

  // Verify group exists
  const [group] = await db
    .select()
    .from(workoutGroups)
    .where(eq(workoutGroups.id, groupId));
  if (!group) throw ApiError.notFound(`Group ${groupId} not found`);

  // Create session
  const [session] = await db
    .insert(workoutSessions)
    .values({ groupId })
    .returning();

  // Create exercise logs from group exercises
  const groupExs = await db
    .select({
      exerciseId: groupExercises.exerciseId,
      position: groupExercises.position,
      defaultSets: groupExercises.defaultSets,
      defaultReps: groupExercises.defaultReps,
      defaultWeight: groupExercises.defaultWeight,
      defaultDistanceKm: groupExercises.defaultDistanceKm,
      defaultDurationMinutes: groupExercises.defaultDurationMinutes,
      trackingType: exercises.trackingType,
    })
    .from(groupExercises)
    .innerJoin(exercises, eq(groupExercises.exerciseId, exercises.id))
    .where(eq(groupExercises.groupId, groupId))
    .orderBy(groupExercises.position);

  if (groupExs.length) {
    const createdLogs = await db
      .insert(sessionExerciseLogs)
      .values(
        groupExs.map((ge) => ({
          sessionId: session.id,
          exerciseId: ge.exerciseId,
          position: ge.position,
        })),
      )
      .returning({
        id: sessionExerciseLogs.id,
        exerciseId: sessionExerciseLogs.exerciseId,
        position: sessionExerciseLogs.position,
      });

    const plannedSets = createdLogs.flatMap((log) => {
      const groupExercise = groupExs.find(
        (exercise) =>
          exercise.exerciseId === log.exerciseId &&
          exercise.position === log.position,
      );
      if (!groupExercise) return [];

      const plannedEntryCount =
        groupExercise.trackingType === "run"
          ? 1
          : groupExercise.defaultSets;

      return Array.from({ length: plannedEntryCount }, (_, index) => ({
        sessionExerciseLogId: log.id,
        setNumber: index + 1,
        weight:
          groupExercise.trackingType === "run"
            ? null
            : groupExercise.defaultWeight,
        reps:
          groupExercise.trackingType === "run"
            ? null
            : groupExercise.defaultReps,
        distanceKm:
          groupExercise.trackingType === "run"
            ? groupExercise.defaultDistanceKm
            : null,
        durationMinutes:
          groupExercise.trackingType === "run"
            ? groupExercise.defaultDurationMinutes
            : null,
      }));
    });

    if (plannedSets.length > 0) {
      await db.insert(sessionSets).values(plannedSets);
    }
  }

  return c.json(ok(session, "Session started"), 201);
});

// Resume an in-progress session
workoutsRoute.get("/sessions/:id", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const id = c.req.param("id");

  const [session] = await db
    .select()
    .from(workoutSessions)
    .where(eq(workoutSessions.id, id));
  if (!session) throw ApiError.notFound(`Session ${id} not found`);

  // Get exercise logs with exercise details
  const logs = await db
    .select({
      id: sessionExerciseLogs.id,
      position: sessionExerciseLogs.position,
      exerciseId: exercises.id,
      exerciseName: exercises.name,
      exerciseCategory: exercises.category,
      equipmentType: exercises.equipmentType,
      trackingType: exercises.trackingType,
    })
    .from(sessionExerciseLogs)
    .innerJoin(
      exercises,
      eq(sessionExerciseLogs.exerciseId, exercises.id),
    )
    .where(eq(sessionExerciseLogs.sessionId, id))
    .orderBy(sessionExerciseLogs.position);

  // Get sets for each log
  const logIds = logs.map((l) => l.id);
  const allSets = logIds.length
    ? await db
        .select()
        .from(sessionSets)
        .where(
          sql`${sessionSets.sessionExerciseLogId} IN (${sql.join(logIds.map((lid) => sql`${lid}`), sql`, `)})`,
        )
        .orderBy(sessionSets.setNumber)
    : [];

  const logsWithSets = logs.map((log) => ({
    ...log,
    sets: allSets.filter((s) => s.sessionExerciseLogId === log.id),
  }));

  return c.json(ok({ ...session, exerciseLogs: logsWithSets }));
});

// Log a set
workoutsRoute.post(
  "/sessions/:sessionId/logs/:logId/sets",
  async (c) => {
    const env = getEnv(c.env);
    const db = createDatabase(env.databaseUrl);
    const logId = c.req.param("logId");
    const body = setLogSchema.parse(await c.req.json());

    const [pendingSet] = await db
      .select()
      .from(sessionSets)
      .where(
        and(
          eq(sessionSets.sessionExerciseLogId, logId),
          isNull(sessionSets.completedAt),
        ),
      )
      .orderBy(sessionSets.setNumber)
      .limit(1);

    if (pendingSet) {
      const [updated] = await db
        .update(sessionSets)
        .set({
          weight: body.weight ?? pendingSet.weight,
          reps: body.reps ?? pendingSet.reps,
          distanceKm: body.distanceKm ?? pendingSet.distanceKm,
          durationMinutes:
            body.durationMinutes ?? pendingSet.durationMinutes,
          completedAt: new Date(),
        })
        .where(eq(sessionSets.id, pendingSet.id))
        .returning();
      return c.json(ok(updated, "Set logged"), 201);
    }

    // Allow an additional set after the planned sets are complete.
    const existingSets = await db
      .select()
      .from(sessionSets)
      .where(eq(sessionSets.sessionExerciseLogId, logId));

    const [created] = await db
      .insert(sessionSets)
      .values({
        sessionExerciseLogId: logId,
        setNumber: existingSets.length + 1,
        weight: body.weight ?? null,
        reps: body.reps ?? null,
        distanceKm: body.distanceKm ?? null,
        durationMinutes: body.durationMinutes ?? null,
        completedAt: new Date(),
      })
      .returning();

    return c.json(ok(created, "Set logged"), 201);
  },
);

// Edit a completed or planned set
workoutsRoute.patch(
  "/sessions/:sessionId/logs/:logId/sets/:setId",
  async (c) => {
    const env = getEnv(c.env);
    const db = createDatabase(env.databaseUrl);
    const sessionId = c.req.param("sessionId");
    const logId = c.req.param("logId");
    const setId = c.req.param("setId");
    const body = setLogSchema.parse(await c.req.json());

    const [log] = await db
      .select({ id: sessionExerciseLogs.id })
      .from(sessionExerciseLogs)
      .where(
        and(
          eq(sessionExerciseLogs.id, logId),
          eq(sessionExerciseLogs.sessionId, sessionId),
        ),
      );
    if (!log) throw ApiError.notFound(`Exercise log ${logId} not found`);

    const [updated] = await db
      .update(sessionSets)
      .set({
        ...(body.weight !== undefined ? { weight: body.weight } : {}),
        ...(body.reps !== undefined ? { reps: body.reps } : {}),
        ...(body.distanceKm !== undefined
          ? { distanceKm: body.distanceKm }
          : {}),
        ...(body.durationMinutes !== undefined
          ? { durationMinutes: body.durationMinutes }
          : {}),
      })
      .where(
        and(
          eq(sessionSets.id, setId),
          eq(sessionSets.sessionExerciseLogId, logId),
        ),
      )
      .returning();
    if (!updated) throw ApiError.notFound(`Set ${setId} not found`);

    return c.json(ok(updated, "Set updated"));
  },
);

// Finish a session
workoutsRoute.post("/sessions/:id/finish", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);
  const id = c.req.param("id");

  const [session] = await db
    .select()
    .from(workoutSessions)
    .where(eq(workoutSessions.id, id));
  if (!session) throw ApiError.notFound(`Session ${id} not found`);

  // Calculate totals
  const logs = await db
    .select()
    .from(sessionExerciseLogs)
    .where(eq(sessionExerciseLogs.sessionId, id));

  let totalSets = 0;
  let totalVolume = 0;

  for (const log of logs) {
    const sets = await db
      .select()
      .from(sessionSets)
      .where(eq(sessionSets.sessionExerciseLogId, log.id));
    const completedSets = sets.filter((set) => set.completedAt !== null);
    totalSets += completedSets.filter(
      (set) => set.distanceKm === null,
    ).length;
    for (const s of completedSets) {
      totalVolume += (s.weight ?? 0) * (s.reps ?? 0);
    }
  }

  const durationMinutes = Math.round(
    (Date.now() - new Date(session.startedAt).getTime()) / 60000,
  );

  const [updated] = await db
    .update(workoutSessions)
    .set({
      status: "completed",
      finishedAt: new Date(),
      totalSets,
      totalVolume,
      durationMinutes,
    })
    .where(eq(workoutSessions.id, id))
    .returning();

  return c.json(ok(updated, "Session finished"));
});

export default workoutsRoute;
