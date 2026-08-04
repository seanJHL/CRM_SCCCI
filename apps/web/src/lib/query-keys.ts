/**
 * Centralised TanStack Query key factory.
 * Keeps cache keys consistent and refactor-safe.
 */
export const queryKeys = {
  events: {
    all: ["events"] as const,
    range: (from: string, to: string) => ["events", from, to] as const,
    detail: (id: string) => ["events", id] as const,
  },
  workoutGroups: {
    all: ["workoutGroups"] as const,
    detail: (id: string) => ["workoutGroups", id] as const,
  },
  workoutPerformance: {
    all: ["workoutPerformance"] as const,
    byExercises: (ids: string[]) =>
      ["workoutPerformance", [...ids].sort().join(",")] as const,
  },
  workoutSessions: {
    detail: (id: string) => ["workoutSessions", id] as const,
  },
  exercises: {
    all: ["exercises"] as const,
    search: (q: string) => ["exercises", "search", q] as const,
  },
  tasks: {
    range: (from: string, to: string) => ["tasks", from, to] as const,
  },
  habits: {
    all: ["habits"] as const,
    detail: (id: string) => ["habits", id] as const,
    completions: (id: string, from: string, to: string) =>
      ["habits", id, "completions", from, to] as const,
  },
  reminders: {
    all: ["reminders"] as const,
  },
  planner: {
    tasks: ["plannerTasks"] as const,
    detail: (id: string) => ["plannerTasks", id] as const,
  },
  analytics: {
    weeklySummary: ["analytics", "weeklySummary"] as const,
    meetingsWeekly: ["analytics", "meetingsWeekly"] as const,
    exerciseWeekly: ["analytics", "exerciseWeekly"] as const,
    streaks: ["analytics", "streaks"] as const,
  },
} as const;

// --- Type definitions matching the backend schema ---

export interface Event {
  id: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string;
  isAllDay: boolean;
  color: string | null;
  recurrenceRule: string | null;
  recurrenceExpiryAt: string | null;
  recurrenceStatus: string;
  isOptional: boolean;
  category: "meeting" | "shift" | "personal" | "deadline";
  tags: string | null;
  link: string | null;
  source: "ember" | "google_crm";
  ownerUserId: string | null;
  googleEventId: string | null;
  crmBookingId: string | null;
  exercises?: EventExercise[];
  completions?: EventCompletion[];
  createdAt: string;
  updatedAt: string;
}

export interface EventCompletion {
  id: string;
  eventId: string;
  occurrenceStart: string;
  completedAt: string;
}

export interface EventExercise {
  id: string;
  exerciseId: string;
  exerciseName: string;
  exerciseCategory: string;
  sets: number;
  reps: number;
  weight: number | null;
  position: number;
}

export interface WorkoutGroup {
  id: string;
  name: string;
  targetDays: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface Exercise {
  id: string;
  name: string;
  category: string;
  equipmentType: string;
  trackingType: "strength" | "run";
}

export interface TaskItem {
  id: string;
  taskId: string;
  label: string;
  completed: boolean;
  completedAt: string | null;
  position: number;
}

export interface Task {
  id: string;
  title: string;
  dueAt: string | null;
  createdAt: string;
  updatedAt: string;
  items: TaskItem[];
}

export interface GroupExercise {
  id: string;
  position: number;
  defaultSets: number;
  defaultReps: number;
  defaultWeight: number | null;
  defaultDistanceKm: number | null;
  defaultDurationMinutes: number | null;
  exerciseId: string;
  exerciseName: string;
  exerciseCategory: string;
  equipmentType: string;
  trackingType: "strength" | "run";
  performance?: ExercisePerformance | null;
}

export interface ExercisePerformanceSet {
  setNumber: number;
  weight: number | null;
  reps: number | null;
  distanceKm: number | null;
  durationMinutes: number | null;
}

export interface ExercisePerformance {
  exerciseId: string;
  maxWeight: number | null;
  maxReps: number | null;
  maxDistanceKm: number | null;
  fastestPaceMinPerKm: number | null;
  bestSet: {
    weight: number | null;
    reps: number | null;
    distanceKm: number | null;
    durationMinutes: number | null;
    estimatedOneRepMax: number | null;
  } | null;
  previousWorkout: {
    sessionId: string;
    performedAt: string;
    sets: ExercisePerformanceSet[];
  } | null;
}

export interface WorkoutSession {
  id: string;
  groupId: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  totalVolume: number | null;
  totalSets: number | null;
  durationMinutes: number | null;
}

export interface SessionSet {
  id: string;
  sessionExerciseLogId: string;
  setNumber: number;
  weight: number | null;
  reps: number | null;
  distanceKm: number | null;
  durationMinutes: number | null;
  completedAt: string | null;
}

export interface SessionExerciseLog {
  id: string;
  position: number;
  exerciseId: string;
  exerciseName: string;
  exerciseCategory: string;
  equipmentType: string;
  trackingType: "strength" | "run";
  sets: SessionSet[];
}

export interface Habit {
  id: string;
  name: string;
  description: string | null;
  targetMetric: string | null;
  streakCount: number;
  createdAt: string;
}

export interface HabitCompletion {
  id: string;
  habitId: string;
  completedAt: string;
  metricValue: string | null;
}

export interface Reminder {
  id: string;
  name: string;
  scheduleType: "interval" | "daily_time";
  intervalMinutes: number | null;
  timeOfDay: string | null;
  timeZone: string;
  isActive: boolean;
  lastFiredAt: string | null;
  createdAt: string;
}

export interface PlannerTask {
  id: string;
  title: string;
  deadlineAt: string;
  effortEstimateHours: number;
  description: string | null;
  status: string;
  createdAt: string;
}

export interface PlannerBlock {
  id: string;
  taskId: string;
  scheduledStart: string;
  scheduledEnd: string;
  status: string;
}

export interface WeeklySummary {
  weekOf: string;
  meetings: { count: number; totalHours: number };
  exercise: {
    sessions: number;
    volumeKg: number;
    totalSets: number;
    weeksInRow: number;
  };
}

export interface StreaksData {
  workoutStreak: number;
  meetingStreak: number;
  habitStreaks: Array<{
    habitId: string;
    habitName: string;
    streakCount: number;
  }>;
  currentWeekActive: boolean;
}
