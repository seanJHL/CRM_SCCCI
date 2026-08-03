import { Hono } from "hono";
import { eq, gte, lte, and, sql } from "drizzle-orm";
import type { AppBindings } from "@/types";
import { createDatabase } from "@/db";
import {
  events,
  workoutSessions,
  habits,
} from "@/db/schema";
import { ok } from "@/lib/utils";
import { getEnv } from "@/lib/env";

const analyticsRoute = new Hono<AppBindings>();

// Weekly meeting audit
analyticsRoute.get("/meetings/weekly", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);

  // Default to current week
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay() + 1); // Monday
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);

  const from = c.req.query("from")
    ? new Date(c.req.query("from")!)
    : weekStart;
  const to = c.req.query("to") ? new Date(c.req.query("to")!) : weekEnd;

  const weekEvents = await db
    .select()
    .from(events)
    .where(
      and(
        gte(events.startAt, from),
        lte(events.startAt, to),
        eq(events.category, "meeting"),
      ),
    );

  let totalMinutes = 0;
  let recurringCount = 0;
  let oneOffCount = 0;
  let optionalAttended = 0;

  for (const event of weekEvents) {
    const duration =
      (new Date(event.endAt).getTime() -
        new Date(event.startAt).getTime()) /
      60000;
    totalMinutes += duration;

    if (event.recurrenceRule && event.recurrenceStatus === "active") {
      recurringCount++;
    } else {
      oneOffCount++;
    }

    if (event.isOptional) {
      optionalAttended++;
    }
  }

  return c.json(
    ok({
      period: { from: from.toISOString(), to: to.toISOString() },
      totalMeetings: weekEvents.length,
      totalHours: Math.round((totalMinutes / 60) * 10) / 10,
      recurringCount,
      oneOffCount,
      optionalAttended,
      recurringPercentage:
        weekEvents.length > 0
          ? Math.round((recurringCount / weekEvents.length) * 100)
          : 0,
    }),
  );
});

// Weekly exercise load
analyticsRoute.get("/exercise/weekly", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);

  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay() + 1);
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);

  const from = c.req.query("from")
    ? new Date(c.req.query("from")!)
    : weekStart;
  const to = c.req.query("to") ? new Date(c.req.query("to")!) : weekEnd;

  const sessions = await db
    .select()
    .from(workoutSessions)
    .where(
      and(
        gte(workoutSessions.startedAt, from),
        lte(workoutSessions.startedAt, to),
        eq(workoutSessions.status, "completed"),
      ),
    );

  const totalSessions = sessions.length;
  const totalVolume = sessions.reduce(
    (sum, s) => sum + (s.totalVolume ?? 0),
    0,
  );
  const totalSets = sessions.reduce(
    (sum, s) => sum + (s.totalSets ?? 0),
    0,
  );
  const totalMinutes = sessions.reduce(
    (sum, s) => sum + (s.durationMinutes ?? 0),
    0,
  );

  return c.json(
    ok({
      period: { from: from.toISOString(), to: to.toISOString() },
      totalSessions,
      totalVolume: Math.round(totalVolume),
      totalSets,
      totalMinutes,
    }),
  );
});

// Combined weekly stats (for shareable card)
analyticsRoute.get("/weekly-summary", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);

  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay() + 1);
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);

  // Meetings
  const weekEvents = await db
    .select()
    .from(events)
    .where(
      and(
        gte(events.startAt, weekStart),
        lte(events.startAt, weekEnd),
        eq(events.category, "meeting"),
      ),
    );

  let meetingMinutes = 0;
  for (const event of weekEvents) {
    meetingMinutes +=
      (new Date(event.endAt).getTime() -
        new Date(event.startAt).getTime()) /
      60000;
  }

  // Exercise
  const sessions = await db
    .select()
    .from(workoutSessions)
    .where(
      and(
        gte(workoutSessions.startedAt, weekStart),
        lte(workoutSessions.startedAt, weekEnd),
        eq(workoutSessions.status, "completed"),
      ),
    );

  const totalVolume = sessions.reduce(
    (sum, s) => sum + (s.totalVolume ?? 0),
    0,
  );
  const totalSets = sessions.reduce(
    (sum, s) => sum + (s.totalSets ?? 0),
    0,
  );

  // Calculate streak (consecutive weeks with at least 1 session)
  const streakResult = await db.execute(sql`
    WITH weekly AS (
      SELECT DATE_TRUNC('week', started_at) AS week_start
      FROM workout_sessions
      WHERE status = 'completed'
      GROUP BY DATE_TRUNC('week', started_at)
      ORDER BY week_start DESC
    ),
    numbered AS (
      SELECT week_start,
             ROW_NUMBER() OVER (ORDER BY week_start DESC) as rn
      FROM weekly
    )
    SELECT COUNT(*) as streak
    FROM numbered
    WHERE week_start >= CURRENT_DATE - (rn * INTERVAL '7 days')
  `);

  const weeksInRow =
    streakResult.rows.length > 0
      ? Number(streakResult.rows[0]?.streak ?? 0)
      : 0;

  c.header("Cache-Control", "private, max-age=120");
  return c.json(
    ok({
      weekOf: weekStart.toISOString().split("T")[0],
      meetings: {
        count: weekEvents.length,
        totalHours: Math.round((meetingMinutes / 60) * 10) / 10,
      },
      exercise: {
        sessions: sessions.length,
        volumeKg: Math.round(totalVolume),
        totalSets,
        weeksInRow,
      },
    }),
  );
});

// Streaks: workout, meeting, and habit streaks (Strava-style)
analyticsRoute.get("/streaks", async (c) => {
  const env = getEnv(c.env);
  const db = createDatabase(env.databaseUrl);

  // Workout streak: consecutive weeks with at least 1 completed session
  const workoutStreakResult = await db.execute(sql`
    WITH weekly AS (
      SELECT DATE_TRUNC('week', started_at) AS week_start
      FROM workout_sessions
      WHERE status = 'completed'
      GROUP BY DATE_TRUNC('week', started_at)
      ORDER BY week_start DESC
    ),
    numbered AS (
      SELECT week_start,
             ROW_NUMBER() OVER (ORDER BY week_start DESC) as rn
      FROM weekly
    )
    SELECT COUNT(*) as streak
    FROM numbered
    WHERE week_start >= CURRENT_DATE - (rn * INTERVAL '7 days')
  `);
  const workoutStreak =
    workoutStreakResult.rows.length > 0
      ? Number(workoutStreakResult.rows[0]?.streak ?? 0)
      : 0;

  // Meeting streak: consecutive weeks with at least 1 meeting event
  const meetingStreakResult = await db.execute(sql`
    WITH weekly AS (
      SELECT DATE_TRUNC('week', start_at) AS week_start
      FROM events
      WHERE category = 'meeting'
      GROUP BY DATE_TRUNC('week', start_at)
      ORDER BY week_start DESC
    ),
    numbered AS (
      SELECT week_start,
             ROW_NUMBER() OVER (ORDER BY week_start DESC) as rn
      FROM weekly
    )
    SELECT COUNT(*) as streak
    FROM numbered
    WHERE week_start >= CURRENT_DATE - (rn * INTERVAL '7 days')
  `);
  const meetingStreak =
    meetingStreakResult.rows.length > 0
      ? Number(meetingStreakResult.rows[0]?.streak ?? 0)
      : 0;

  // Habit streaks: per-habit streak counts
  const habitRows = await db
    .select({
      habitId: habits.id,
      habitName: habits.name,
      streakCount: habits.streakCount,
    })
    .from(habits)
    .orderBy(habits.streakCount);

  // Current week active: has any session or event this week
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay() + 1);
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);

  const thisWeekEvents = await db
    .select({ id: events.id })
    .from(events)
    .where(and(gte(events.startAt, weekStart), lte(events.startAt, weekEnd)))
    .limit(1);

  const thisWeekSessions = await db
    .select({ id: workoutSessions.id })
    .from(workoutSessions)
    .where(
      and(
        gte(workoutSessions.startedAt, weekStart),
        lte(workoutSessions.startedAt, weekEnd),
        eq(workoutSessions.status, "completed"),
      ),
    )
    .limit(1);

  const currentWeekActive =
    thisWeekEvents.length > 0 || thisWeekSessions.length > 0;

  c.header("Cache-Control", "private, max-age=120");
  return c.json(
    ok({
      workoutStreak,
      meetingStreak,
      habitStreaks: habitRows,
      currentWeekActive,
    }),
  );
});

export default analyticsRoute;
