import {
  pgTable,
  text,
  timestamp,
  boolean,
  uuid,
  integer,
  real,
  jsonb,
  uniqueIndex,
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
  // Integration metadata. Legacy Ember events keep source="ember" and no
  // owner; OAuth-backed CRM meetings are private to their Google account and
  // deduplicated by the originating CRM booking.
  source: text("source").notNull().default("ember"),
  ownerUserId: uuid("owner_user_id"),
  googleEventId: text("google_event_id"),
  crmBookingId: uuid("crm_booking_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastNotifiedAt: timestamp("last_notified_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("events_crm_booking_unique").on(table.crmBookingId),
  uniqueIndex("events_owner_google_event_unique").on(
    table.ownerUserId,
    table.googleEventId,
  ),
]);

// Completion is stored per occurrence so checking off one date in a recurring
// series does not complete every past and future occurrence.
export const eventCompletions = pgTable(
  "event_completions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    occurrenceStart: timestamp("occurrence_start", { withTimezone: true })
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("event_completions_event_occurrence_unique").on(
      table.eventId,
      table.occurrenceStart,
    ),
  ],
);

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
  timeZone: text("time_zone").notNull().default("Asia/Singapore"),
  isActive: boolean("is_active").notNull().default(true),
  lastFiredAt: timestamp("last_fired_at", { withTimezone: true }),
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
// CRM Users
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  avatarUrl: text("avatar_url"),
  timezone: text("timezone").notNull().default("Asia/Singapore"),
  workingHoursStart: text("working_hours_start")
    .notNull()
    .default("09:00"),
  workingHoursEnd: text("working_hours_end").notNull().default("18:00"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Auth Sessions
// ---------------------------------------------------------------------------

export const authSessions = pgTable("auth_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Google Accounts (encrypted OAuth tokens)
// ---------------------------------------------------------------------------

export const googleAccounts = pgTable(
  "google_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    googleId: text("google_id").notNull(),
    email: text("email").notNull(),
    encryptedAccessToken: text("encrypted_access_token").notNull(),
    encryptedRefreshToken: text("encrypted_refresh_token"),
    tokenExpiry: timestamp("token_expiry", { withTimezone: true }),
    scopes: text("scopes").notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("google_accounts_user_unique").on(table.userId),
    uniqueIndex("google_accounts_google_id_unique").on(table.googleId),
  ],
);

// ---------------------------------------------------------------------------
// Email Threads (cached Gmail thread metadata + classification)
// ---------------------------------------------------------------------------

export const emailThreads = pgTable(
  "email_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    gmailThreadId: text("gmail_thread_id").notNull(),
    subject: text("subject"),
    snippet: text("snippet"),
    fromEmail: text("from_email"),
    fromName: text("from_name"),
    lastMessageDate: timestamp("last_message_date", { withTimezone: true }),
    category: text("category").notNull().default("general"),
    categoryManuallySet: boolean("category_manually_set")
      .notNull()
      .default(false),
    priority: text("priority").notNull().default("normal"),
    priorityManuallySet: boolean("priority_manually_set")
      .notNull()
      .default(false),
    requiresResponse: boolean("requires_response").notNull().default(false),
    status: text("status").notNull().default("unread"),
    importanceReason: text("importance_reason"),
    hasUnread: boolean("has_unread").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("email_threads_user_gmail_thread_unique").on(
      table.userId,
      table.gmailThreadId,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Suggested Replies
// ---------------------------------------------------------------------------

export const suggestedReplies = pgTable("suggested_replies", {
  id: uuid("id").primaryKey().defaultRandom(),
  threadId: uuid("thread_id")
    .notNull()
    .references(() => emailThreads.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  status: text("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
});

// ---------------------------------------------------------------------------
// Meeting Requests (detected scheduling intent)
// ---------------------------------------------------------------------------

export const meetingRequests = pgTable(
  "meeting_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id").references(() => emailThreads.id, {
      onDelete: "cascade",
    }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    rawText: text("raw_text"),
    parsedStart: timestamp("parsed_start", { withTimezone: true }),
    parsedEnd: timestamp("parsed_end", { withTimezone: true }),
    timezone: text("timezone"),
    durationMinutes: integer("duration_minutes").default(30),
    status: text("status").notNull().default("detected"),
    suggestedSlots: jsonb("suggested_slots"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("meeting_requests_user_thread_unique").on(
      table.userId,
      table.threadId,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Calendar Bookings (events created via CRM)
// ---------------------------------------------------------------------------

export const calendarBookings = pgTable(
  "calendar_bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    googleEventId: text("google_event_id"),
    title: text("title").notNull(),
    description: text("description"),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    attendees: jsonb("attendees"),
    meetLink: text("meet_link"),
    location: text("location"),
    sourceThreadId: uuid("source_thread_id").references(() => emailThreads.id, {
      onDelete: "set null",
    }),
    status: text("status").notNull().default("confirmed"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("calendar_bookings_user_google_event_unique").on(
      table.userId,
      table.googleEventId,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Audit Logs
// ---------------------------------------------------------------------------

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  resourceType: text("resource_type").notNull(),
  resourceId: text("resource_id"),
  details: jsonb("details"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Type exports
// ---------------------------------------------------------------------------

export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;

export type EventCompletion = typeof eventCompletions.$inferSelect;
export type NewEventCompletion = typeof eventCompletions.$inferInsert;

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

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type AuthSession = typeof authSessions.$inferSelect;
export type NewAuthSession = typeof authSessions.$inferInsert;

export type GoogleAccount = typeof googleAccounts.$inferSelect;
export type NewGoogleAccount = typeof googleAccounts.$inferInsert;

export type EmailThread = typeof emailThreads.$inferSelect;
export type NewEmailThread = typeof emailThreads.$inferInsert;

export type SuggestedReply = typeof suggestedReplies.$inferSelect;
export type NewSuggestedReply = typeof suggestedReplies.$inferInsert;

export type MeetingRequest = typeof meetingRequests.$inferSelect;
export type NewMeetingRequest = typeof meetingRequests.$inferInsert;

export type CalendarBooking = typeof calendarBookings.$inferSelect;
export type NewCalendarBooking = typeof calendarBookings.$inferInsert;

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
