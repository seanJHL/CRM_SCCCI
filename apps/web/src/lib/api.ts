/**
 * API client for the Hono backend.
 * Reads the backend URL from the VITE_API_URL environment variable.
 */

import { getApiUrl } from "@/lib/api-url";

const LOCAL_KEYS = {
  events: "ember:local:events",
  exercises: "ember:local:exercises",
  groups: "ember:local:workout-groups",
  sessions: "ember:local:workout-sessions",
} as const;

type LocalExercise = {
  id: string;
  name: string;
  category: string;
  equipmentType: string;
  trackingType: "strength" | "run";
  createdAt?: string;
  updatedAt?: string;
};

type LocalGroupExerciseConfig = {
  exerciseId: string;
  position?: number;
  defaultSets?: number;
  defaultReps?: number;
  defaultWeight?: number;
  defaultDistanceKm?: number;
  defaultDurationMinutes?: number;
};

type LocalWorkoutGroup = {
  id: string;
  name: string;
  targetDays: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  exerciseConfigs?: LocalGroupExerciseConfig[];
};

type LocalSet = {
  id: string;
  sessionExerciseLogId: string;
  setNumber: number;
  weight: number | null;
  reps: number | null;
  distanceKm: number | null;
  durationMinutes: number | null;
  completedAt: string | null;
};

type LocalExerciseLog = {
  id: string;
  position: number;
  exerciseId: string;
  exerciseName: string;
  exerciseCategory: string;
  equipmentType: string;
  trackingType: "strength" | "run";
  sets: LocalSet[];
};

type LocalWorkoutSession = {
  id: string;
  groupId: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  totalVolume: number;
  totalSets: number;
  durationMinutes: number | null;
  exerciseLogs: LocalExerciseLog[];
};

/** A set enriched with its parent session's identity, used by the performance query. */
type LocalSetWithSession = LocalSet & {
  sessionId: string;
  performedAt: string;
  sessionStatus: string;
};

export { getApiUrl } from "@/lib/api-url";

/** Standard error shape returned by the backend. */
export interface ApiErrorShape {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId?: string;
}

/** Standard success response. */
export interface ApiSuccess<T> {
  success: true;
  data: T;
  message: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiErrorShape;

export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(message: string, code: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

async function request<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const url = getApiUrl(path);
  try {
    const res = await fetch(url, {
      ...options,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(options?.headers ?? {}),
      },
    });
    const body = (await res.json().catch(() => null)) as ApiResponse<T> | null;
    if (!body) {
      throw new ApiClientError(
        "The server returned an unreadable response",
        "INVALID_RESPONSE",
        res.status,
      );
    }
    if (!body.success) {
      throw new ApiClientError(
        body.error.message,
        body.error.code,
        res.status,
        body.error.details,
      );
    }
    return body.data;
  } catch (error) {
    const localResult = await localFallback(path, options);
    if (localResult.handled) return localResult.data as T;
    throw error;
  }
}

function readLocal<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    return JSON.parse(window.localStorage.getItem(key) ?? "") as T;
  } catch {
    return fallback;
  }
}

function writeLocal(key: string, value: unknown) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

function payload(options?: RequestInit) {
  if (typeof options?.body !== "string") return {};
  try {
    return JSON.parse(options.body) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function id() {
  return crypto.randomUUID();
}

type LocalResult = { handled: true; data: unknown } | { handled: false };

async function localFallback(
  rawPath: string,
  options?: RequestInit,
): Promise<LocalResult> {
  if (typeof window === "undefined") return { handled: false };
  const url = new URL(rawPath, window.location.origin);
  const path = url.pathname;
  const method = options?.method ?? "GET";
  const body = payload(options);

  const eventCompletionMatch = path.match(
    /^\/api\/events\/([^/]+)\/completions\/toggle$/,
  );
  if (eventCompletionMatch && method === "POST") {
    const events = readLocal<Record<string, unknown>[]>(LOCAL_KEYS.events, []);
    const eventIndex = events.findIndex(
      (event) => event.id === eventCompletionMatch[1],
    );
    if (eventIndex === -1 || typeof body.occurrenceStart !== "string") {
      return { handled: false };
    }

    const event = events[eventIndex];
    const completions = Array.isArray(event.completions)
      ? (event.completions as Record<string, unknown>[])
      : [];
    const existing = completions.find(
      (completion) => completion.occurrenceStart === body.occurrenceStart,
    );
    const nextCompletions = existing
      ? completions.filter((completion) => completion !== existing)
      : [
          ...completions,
          {
            id: id(),
            eventId: eventCompletionMatch[1],
            occurrenceStart: body.occurrenceStart,
            completedAt: new Date().toISOString(),
          },
        ];
    const nextEvents = [...events];
    nextEvents[eventIndex] = { ...event, completions: nextCompletions };
    writeLocal(LOCAL_KEYS.events, nextEvents);
    return {
      handled: true,
      data: { completed: !existing },
    };
  }

  if (path === "/api/events") {
    const events = readLocal<Record<string, unknown>[]>(LOCAL_KEYS.events, []);
    if (method === "GET") {
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      return {
        handled: true,
        data: events.filter((event) => {
          if (!from || !to) return true;
          const start = String(event.startAt);
          const end = String(event.endAt);
          const overlapsRange = start <= to && end >= from;
          const recurringInRange =
            event.recurrenceStatus === "active" &&
            start <= to &&
            typeof event.recurrenceExpiryAt === "string" &&
            event.recurrenceExpiryAt >= from;
          return overlapsRange || recurringInRange;
        }),
      };
    }
    if (method === "POST") {
      const now = new Date().toISOString();
      const event = {
        id: id(),
        description: null,
        isAllDay: false,
        color: null,
        recurrenceRule: null,
        recurrenceExpiryAt: null,
        isOptional: false,
        link: null,
        completions: [],
        createdAt: now,
        updatedAt: now,
        ...body,
        recurrenceStatus: body.recurrenceRule ? "active" : "none",
      };
      writeLocal(LOCAL_KEYS.events, [...events, event]);
      return { handled: true, data: event };
    }
  }

  const { STATIC_EXERCISES } = await import("@/lib/exercise-data");
  const customExercises = readLocal<LocalExercise[]>(LOCAL_KEYS.exercises, []);
  const exercises: LocalExercise[] = [
    ...STATIC_EXERCISES.map((exercise) => ({
      ...exercise,
      trackingType: exercise.trackingType ?? ("strength" as const),
    })),
    ...customExercises,
  ];

  if (path === "/api/exercises") {
    if (method === "GET") return { handled: true, data: exercises };
    if (method === "POST") {
      const name = String(body.name ?? "").trim();
      if (!name) return { handled: false };
      const existing = exercises.find(
        (exercise) => exercise.name.toLowerCase() === name.toLowerCase(),
      );
      if (existing) return { handled: true, data: existing };

      const now = new Date().toISOString();
      const exercise: LocalExercise = {
        id: id(),
        name,
        category: String(body.category ?? "functional"),
        equipmentType: String(body.equipmentType ?? "other"),
        trackingType: body.trackingType === "run" ? "run" : "strength",
        createdAt: now,
        updatedAt: now,
      };
      writeLocal(LOCAL_KEYS.exercises, [...customExercises, exercise]);
      return { handled: true, data: exercise };
    }
  }

  const groups = readLocal<LocalWorkoutGroup[]>(LOCAL_KEYS.groups, []);
  if (path === "/api/workouts/groups") {
    if (method === "GET") return { handled: true, data: groups };
    if (method === "POST") {
      const now = new Date().toISOString();
      const group = {
        id: id(),
        name: body.name,
        targetDays: body.targetDays ?? null,
        status: "active",
        createdAt: now,
        updatedAt: now,
        exerciseConfigs: body.exercises ?? [],
      };
      writeLocal(LOCAL_KEYS.groups, [group, ...groups]);
      return { handled: true, data: group };
    }
  }

  const groupMatch = path.match(/^\/api\/workouts\/groups\/([^/]+)$/);
  if (groupMatch && method === "DELETE") {
    const group = groups.find((item) => item.id === groupMatch[1]);
    if (!group) return { handled: false };

    writeLocal(
      LOCAL_KEYS.groups,
      groups.filter((item) => item.id !== groupMatch[1]),
    );
    const linkedSessions = readLocal<Record<string, unknown>[]>(
      LOCAL_KEYS.sessions,
      [],
    );
    writeLocal(
      LOCAL_KEYS.sessions,
      linkedSessions.filter((session) => session.groupId !== groupMatch[1]),
    );
    return { handled: true, data: { success: true } };
  }

  if (groupMatch && method === "GET") {
    const group = groups.find((item) => item.id === groupMatch[1]);
    if (!group) return { handled: false };
    const configs = group.exerciseConfigs ?? [];
    return {
      handled: true,
      data: {
        ...group,
        exercises: configs.map((config, index) => {
          const exercise = exercises.find(
            (item) => item.id === config.exerciseId,
          );
          return {
            id: `${group.id}-${config.exerciseId}`,
            position: config.position ?? index,
            defaultSets: config.defaultSets ?? 3,
            defaultReps: config.defaultReps ?? 10,
            defaultWeight: config.defaultWeight ?? 0,
            defaultDistanceKm: config.defaultDistanceKm ?? null,
            defaultDurationMinutes: config.defaultDurationMinutes ?? null,
            exerciseId: config.exerciseId,
            exerciseName: exercise?.name ?? "Exercise",
            exerciseCategory: exercise?.category ?? "functional",
            equipmentType: exercise?.equipmentType ?? "other",
            trackingType: exercise?.trackingType ?? "strength",
            performance: null,
          };
        }),
      },
    };
  }

  const sessions = readLocal<LocalWorkoutSession[]>(LOCAL_KEYS.sessions, []);
  if (path === "/api/workouts/performance" && method === "GET") {
    const exerciseIds = (url.searchParams.get("exerciseIds") ?? "")
      .split(",")
      .filter(Boolean);
    return {
      handled: true,
      data: exerciseIds.map((exerciseId) => {
        const history: LocalSetWithSession[] = sessions.flatMap((session) =>
          (session.exerciseLogs ?? [])
            .filter((log) => log.exerciseId === exerciseId)
            .flatMap((log) =>
              (log.sets ?? [])
                .filter((set) => set.completedAt)
                .map((set) => ({
                  ...set,
                  sessionId: session.id,
                  performedAt: session.startedAt,
                  sessionStatus: session.status,
                })),
            ),
        );
        const weighted = history.filter(
          (set) => Number(set.weight ?? 0) > 0,
        );
        const distance = history.filter(
          (set) => Number(set.distanceKm ?? 0) > 0,
        );
        const bestSet =
          history.reduce<LocalSetWithSession | null>((best, set) => {
            if (!best) return set;
            const score =
              Number(set.weight ?? 0) > 0
                ? Number(set.weight ?? 0) *
                  (1 + Number(set.reps ?? 0) / 30)
                : Number(set.reps ?? 0);
            const bestScore =
              Number(best.weight ?? 0) > 0
                ? Number(best.weight ?? 0) *
                  (1 + Number(best.reps ?? 0) / 30)
                : Number(best.reps ?? 0);
            return score > bestScore ? set : best;
          }, null);
        const previousSessionId =
          history.find((set) => set.sessionStatus === "completed")?.sessionId ??
          history[0]?.sessionId;
        const previousSets = previousSessionId
          ? history.filter((set) => set.sessionId === previousSessionId)
          : [];

        return {
          exerciseId,
          maxWeight:
            weighted.length > 0
              ? Math.max(...weighted.map((set) => Number(set.weight ?? 0)))
              : null,
          maxReps:
            history.length > 0
              ? Math.max(...history.map((set) => Number(set.reps ?? 0)))
              : null,
          maxDistanceKm:
            distance.length > 0
              ? Math.max(
                  ...distance.map((set) => Number(set.distanceKm ?? 0)),
                )
              : null,
          fastestPaceMinPerKm:
            distance.length > 0
              ? Math.min(
                  ...distance.map(
                    (set) =>
                      Number(set.durationMinutes ?? 0) /
                      Number(set.distanceKm ?? 1),
                  ),
                )
              : null,
          bestSet: bestSet
            ? {
                weight: bestSet.weight ?? null,
                reps: bestSet.reps ?? null,
                distanceKm: bestSet.distanceKm ?? null,
                durationMinutes: bestSet.durationMinutes ?? null,
                estimatedOneRepMax:
                  Number(bestSet.weight ?? 0) > 0
                    ? Math.round(
                        Number(bestSet.weight ?? 0) *
                          (1 + Number(bestSet.reps ?? 0) / 30) *
                          10,
                      ) / 10
                    : null,
              }
            : null,
          previousWorkout:
            previousSets.length > 0
              ? {
                  sessionId: previousSessionId,
                  performedAt: previousSets[0].performedAt,
                  sets: previousSets.map((set) => ({
                    setNumber: set.setNumber,
                    weight: set.weight ?? null,
                    reps: set.reps ?? null,
                    distanceKm: set.distanceKm ?? null,
                    durationMinutes: set.durationMinutes ?? null,
                  })),
                }
              : null,
        };
      }),
    };
  }

  const startMatch = path.match(
    /^\/api\/workouts\/sessions\/start\/([^/]+)$/,
  );
  if (startMatch && method === "POST") {
    const group = groups.find((item) => item.id === startMatch[1]);
    if (!group) return { handled: false };
    const sessionId = id();
    const configs = group.exerciseConfigs ?? [];
    const exerciseLogs = configs.map((config, index) => {
      const exercise = exercises.find((item) => item.id === config.exerciseId);
      const run = exercise?.trackingType === "run";
      return {
        id: id(),
        position: index,
        exerciseId: config.exerciseId,
        exerciseName: exercise?.name ?? "Exercise",
        exerciseCategory: exercise?.category ?? "functional",
        equipmentType: exercise?.equipmentType ?? "other",
        trackingType: exercise?.trackingType ?? "strength",
        sets: Array.from(
          { length: run ? 1 : Number(config.defaultSets ?? 3) },
          (_, setIndex) => ({
            id: id(),
            sessionExerciseLogId: "",
            setNumber: setIndex + 1,
            weight: run ? null : Number(config.defaultWeight ?? 0),
            reps: run ? null : Number(config.defaultReps ?? 10),
            distanceKm: run
              ? Number(config.defaultDistanceKm ?? 5)
              : null,
            durationMinutes: run
              ? Number(config.defaultDurationMinutes ?? 30)
              : null,
            completedAt: null,
          }),
        ),
      };
    });
    const session = {
      id: sessionId,
      groupId: group.id,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      status: "active",
      totalVolume: 0,
      totalSets: 0,
      durationMinutes: null,
      exerciseLogs,
    };
    writeLocal(LOCAL_KEYS.sessions, [session, ...sessions]);
    return { handled: true, data: session };
  }

  const sessionMatch = path.match(/^\/api\/workouts\/sessions\/([^/]+)$/);
  if (sessionMatch && method === "GET") {
    const session = sessions.find((item) => item.id === sessionMatch[1]);
    return session
      ? { handled: true, data: session }
      : { handled: false };
  }

  const logMatch = path.match(
    /^\/api\/workouts\/sessions\/([^/]+)\/logs\/([^/]+)\/sets$/,
  );
  if (logMatch && method === "POST") {
    let logged: Record<string, unknown> | undefined;
    const next = sessions.map((session) => {
      if (session.id !== logMatch[1]) return session;
      return {
        ...session,
        exerciseLogs: session.exerciseLogs.map((log) => {
          if (log.id !== logMatch[2]) return log;
          let completed = false;
          return {
            ...log,
            sets: log.sets.map((set: Record<string, unknown>) => {
              if (completed || set.completedAt) return set;
              completed = true;
              logged = {
                ...set,
                ...body,
                completedAt: new Date().toISOString(),
              };
              return logged;
            }),
          };
        }),
      };
    });
    writeLocal(LOCAL_KEYS.sessions, next);
    return { handled: true, data: logged ?? body };
  }

  const editSetMatch = path.match(
    /^\/api\/workouts\/sessions\/([^/]+)\/logs\/([^/]+)\/sets\/([^/]+)$/,
  );
  if (editSetMatch && method === "PATCH") {
    let updatedSet: Record<string, unknown> | undefined;
    const next = sessions.map((session) => {
      if (session.id !== editSetMatch[1]) return session;
      return {
        ...session,
        exerciseLogs: session.exerciseLogs.map((log) => {
          if (log.id !== editSetMatch[2]) return log;
          return {
            ...log,
            sets: log.sets.map((set: Record<string, unknown>) => {
              if (set.id !== editSetMatch[3]) return set;
              updatedSet = { ...set, ...body };
              return updatedSet;
            }),
          };
        }),
      };
    });
    writeLocal(LOCAL_KEYS.sessions, next);
    return updatedSet
      ? { handled: true, data: updatedSet }
      : { handled: false };
  }

  const finishMatch = path.match(
    /^\/api\/workouts\/sessions\/([^/]+)\/finish$/,
  );
  if (finishMatch && method === "POST") {
    let finished: LocalWorkoutSession | undefined;
    const next = sessions.map((session) => {
      if (session.id !== finishMatch[1]) return session;
      const sets = session.exerciseLogs.flatMap((log) => log.sets);
      const completed = sets.filter((set) => set.completedAt);
      finished = {
        ...session,
        status: "completed",
        finishedAt: new Date().toISOString(),
        totalSets: completed.length,
        totalVolume: completed.reduce(
          (sum, set) => sum + Number(set.weight ?? 0) * Number(set.reps ?? 0),
          0,
        ),
        durationMinutes: Math.max(
          1,
          Math.round(
            (Date.now() - new Date(session.startedAt).getTime()) / 60_000,
          ),
        ),
      };
      return finished;
    });
    writeLocal(LOCAL_KEYS.sessions, next);
    return finished
      ? { handled: true, data: finished }
      : { handled: false };
  }

  if (path === "/api/analytics/weekly-summary" && method === "GET") {
    const completed = sessions.filter((session) => session.status === "completed");
    return {
      handled: true,
      data: {
        weekOf: new Date().toISOString(),
        meetings: { count: 0, totalHours: 0 },
        exercise: {
          sessions: completed.length,
          volumeKg: completed.reduce(
            (sum, session) => sum + Number(session.totalVolume ?? 0),
            0,
          ),
          totalSets: completed.reduce(
            (sum, session) => sum + Number(session.totalSets ?? 0),
            0,
          ),
          weeksInRow: completed.length > 0 ? 1 : 0,
        },
      },
    };
  }

  return { handled: false };
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: "GET" }),
  post: <T>(path: string, data: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(data) }),
  patch: <T>(path: string, data: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(data) }),
  delete: <T>(path: string, data?: unknown) =>
    request<T>(path, {
      method: "DELETE",
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    }),
};
