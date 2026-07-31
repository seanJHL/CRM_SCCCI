import {
  pgTable,
  text,
  timestamp,
  boolean,
  uuid,
  integer,
  real,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Events (Calendar)
// ---------------------------------------------------------------------------

export const events = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  description: text("description"),
  startAt: timestamp("start_at", { withTimezone: true }).notNull(),
  endAt: timestamp("end_at", { withTimezone: true }).notNull(),
  isAllDay: boolean("is_all_day").notNull().default(false),
  color: text("color"),
  // Recurrence
  recurrenceRule: text("recurrence_rule"), // RRULE string or null
  recurrenceExpiryAt: timestamp("recurrence_expiry_at", {
    withTimezone: true,
  }),
  recurrenceStatus: text("recurrence_status")
    .notNull()
    .default("none"), // none | active | pending_review | expired
  // Metadata
  isOptional: boolean("is_optional").notNull().default(false),
  category: text("category").notNull().default("meeting"), // meeting | shift | personal | deadline
  tags: text("tags"), // comma-separated free-form tags, e.g. "deep-work,health"
  link: text("link"), // URL for video conferencing or external resource (Zoom, Meet, etc.)
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Event Exercises (join table: attach exercises to calendar events)
// ---------------------------------------------------------------------------

export const eventExercises = pgTable("event_exercises", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  exerciseId: uuid("exercise_id")
    .notNull()
    .references(() => exercises.id, { onDelete: "cascade" }),
  sets: integer("sets").notNull().default(3),
  reps: integer("reps").notNull().default(10),
  weight: real("weight"),
  position: integer("position").notNull().default(0),
});

// ---------------------------------------------------------------------------
// Workout Groups
// ---------------------------------------------------------------------------

export const workoutGroups = pgTable("workout_groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  targetDays: text("target_days"), // e.g. "Wed & Sat"
  status: text("status").notNull().default("active"), // active | archived
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Exercises (Master Library)
// ---------------------------------------------------------------------------

export const exercises = pgTable("exercises", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  category: text("category").notNull(), // chest | back | legs | shoulders_arms | cardio
  equipmentType: text("equipment_type").notNull(), // machine | free_weight | bodyweight | cardio
  trackingType: text("tracking_type").notNull().default("strength"), // strength | run
});

// ---------------------------------------------------------------------------
// Group Exercises (join table with defaults)
// ---------------------------------------------------------------------------

export const groupExercises = pgTable("group_exercises", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id")
    .notNull()
    .references(() => workoutGroups.id, { onDelete: "cascade" }),
  exerciseId: uuid("exercise_id")
    .notNull()
    .references(() => exercises.id, { onDelete: "cascade" }),
  position: integer("position").notNull().default(0),
  defaultSets: integer("default_sets").notNull().default(3),
  defaultReps: integer("default_reps").notNull().default(10),
  defaultWeight: real("default_weight"),
  defaultDistanceKm: real("default_distance_km"),
  defaultDurationMinutes: integer("default_duration_minutes"),
});

// ---------------------------------------------------------------------------
// Workout Sessions
// ---------------------------------------------------------------------------

export const workoutSessions = pgTable("workout_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id")
    .notNull()
    .references(() => workoutGroups.id, { onDelete: "cascade" }),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: text("status").notNull().default("in_progress"), // in_progress | completed | abandoned
  totalVolume: real("total_volume").default(0),
  totalSets: integer("total_sets").default(0),
  durationMinutes: integer("duration_minutes"),
});

// ---------------------------------------------------------------------------
// Session Exercise Logs
// ---------------------------------------------------------------------------

export const sessionExerciseLogs = pgTable("session_exercise_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => workoutSessions.id, { onDelete: "cascade" }),
  exerciseId: uuid("exercise_id")
    .notNull()
    .references(() => exercises.id, { onDelete: "cascade" }),
  position: integer("position").notNull().default(0),
});

// ---------------------------------------------------------------------------
// Session Sets
// ---------------------------------------------------------------------------

export const sessionSets = pgTable("session_sets", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionExerciseLogId: uuid("session_exercise_log_id")
    .notNull()
    .references(() => sessionExerciseLogs.id, { onDelete: "cascade" }),
  setNumber: integer("set_number").notNull(),
  weight: real("weight"),
  reps: integer("reps"),
  distanceKm: real("distance_km"),
  durationMinutes: integer("duration_minutes"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

// ---------------------------------------------------------------------------
// Habits
// ---------------------------------------------------------------------------

export const habits = pgTable("habits", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  targetMetric: text("target_metric"), // e.g. "20 min", "8 glasses"
  streakCount: integer("streak_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Habit Completions
// ---------------------------------------------------------------------------

export const habitCompletions = pgTable("habit_completions", {
  id: uuid("id").primaryKey().defaultRandom(),
  habitId: uuid("habit_id")
    .notNull()
    .references(() => habits.id, { onDelete: "cascade" }),
  completedAt: timestamp("completed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  metricValue: text("metric_value"),
});

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------

export const reminders = pgTable("reminders", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  scheduleType: text("schedule_type").notNull(), // interval | daily_time
  intervalMinutes: integer("interval_minutes"),
  timeOfDay: text("time_of_day"), // HH:mm format
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Backward Plan Tasks
// ---------------------------------------------------------------------------

export const plannerTasks = pgTable("planner_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  deadlineAt: timestamp("deadline_at", { withTimezone: true }).notNull(),
  effortEstimateHours: real("effort_estimate_hours").notNull(),
  description: text("description"),
  status: text("status").notNull().default("planning"), // planning | in_progress | completed
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Backward Plan Blocks (auto-generated work blocks)
// ---------------------------------------------------------------------------

export const plannerBlocks = pgTable("planner_blocks", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => plannerTasks.id, { onDelete: "cascade" }),
  scheduledStart: timestamp("scheduled_start", { withTimezone: true }).notNull(),
  scheduledEnd: timestamp("scheduled_end", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("planned"), // planned | done | skipped
});

// ---------------------------------------------------------------------------
// Web Push Subscriptions
// ---------------------------------------------------------------------------

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  endpoint: text("endpoint").notNull().unique(),
  p256dhKey: text("p256dh_key").notNull(),
  authKey: text("auth_key").notNull(),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Type exports
// ---------------------------------------------------------------------------

export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;

export type WorkoutGroup = typeof workoutGroups.$inferSelect;
export type NewWorkoutGroup = typeof workoutGroups.$inferInsert;

export type Exercise = typeof exercises.$inferSelect;
export type NewExercise = typeof exercises.$inferInsert;

export type GroupExercise = typeof groupExercises.$inferSelect;
export type NewGroupExercise = typeof groupExercises.$inferInsert;

export type WorkoutSession = typeof workoutSessions.$inferSelect;
export type NewWorkoutSession = typeof workoutSessions.$inferInsert;

export type SessionExerciseLog = typeof sessionExerciseLogs.$inferSelect;
export type NewSessionExerciseLog = typeof sessionExerciseLogs.$inferInsert;

export type SessionSet = typeof sessionSets.$inferSelect;
export type NewSessionSet = typeof sessionSets.$inferInsert;

export type Habit = typeof habits.$inferSelect;
export type NewHabit = typeof habits.$inferInsert;

export type HabitCompletion = typeof habitCompletions.$inferSelect;
export type NewHabitCompletion = typeof habitCompletions.$inferInsert;

export type Reminder = typeof reminders.$inferSelect;
export type NewReminder = typeof reminders.$inferInsert;

export type PlannerTask = typeof plannerTasks.$inferSelect;
export type NewPlannerTask = typeof plannerTasks.$inferInsert;

export type PlannerBlock = typeof plannerBlocks.$inferSelect;
export type NewPlannerBlock = typeof plannerBlocks.$inferInsert;

export type EventExercise = typeof eventExercises.$inferSelect;
export type NewEventExercise = typeof eventExercises.$inferInsert;

export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type NewPushSubscription = typeof pushSubscriptions.$inferInsert;
