import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useCallback } from "react";
import {
  ArrowLeft,
  Check,
  Timer,
  Dumbbell,
  Clock,
  MapPin,
} from "lucide-react";
import { api } from "@/lib/api";
import { queryKeys, type WorkoutSession, type SessionExerciseLog } from "@/lib/query-keys";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppPreferences } from "@/lib/preferences";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/workouts/$sessionId")({
  component: SessionPage,
});

function SessionPage() {
  const { sessionId } = Route.useParams();
  const queryClient = useQueryClient();
  const { preferences } = useAppPreferences();
  const [elapsed, setElapsed] = useState(0);
  const [showSummary, setShowSummary] = useState(false);
  const [restTimer, setRestTimer] = useState<number | null>(null);

  const { data: session, isLoading } = useQuery({
    queryKey: queryKeys.workoutSessions.detail(sessionId),
    queryFn: () => api.get<WorkoutSession & { exerciseLogs: SessionExerciseLog[] }>(`/api/workouts/sessions/${sessionId}`),
    staleTime: 5_000,
    gcTime: 300_000,
  });

  useEffect(() => {
    if (!session?.startedAt) return;
    const start = new Date(session.startedAt).getTime();
    const interval = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(interval);
  }, [session?.startedAt]);

  useEffect(() => {
    if (restTimer === null) return;
    if (restTimer <= 0) { setRestTimer(null); return; }
    const t = setTimeout(() => setRestTimer(restTimer - 1), 1000);
    return () => clearTimeout(t);
  }, [restTimer]);

  const startRest = useCallback(
    () => setRestTimer(preferences.restTimerSeconds),
    [preferences.restTimerSeconds],
  );

  const finishMutation = useMutation({
    mutationFn: () => api.post(`/api/workouts/sessions/${sessionId}/finish`, {}),
    onSuccess: () => {
      setShowSummary(true);
      queryClient.invalidateQueries({ queryKey: queryKeys.workoutGroups.all });
      queryClient.invalidateQueries({
        queryKey: queryKeys.workoutPerformance.all,
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.workoutSessions.detail(sessionId) });
    },
  });

  const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
  const fmtLong = (s: number) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  if (isLoading) {
    return (
      <div className="p-8">
        <Skeleton className="mb-4 h-6 w-40" />
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32 w-full rounded-lg" />)}
        </div>
      </div>
    );
  }

  if (!session) return <div className="p-8 text-center text-muted-foreground">Session not found.</div>;

  const completedSets = session.exerciseLogs?.reduce((s, l) => s + (l.sets?.filter((s) => s.completedAt).length ?? 0), 0) ?? 0;
  const totalPlannedSets = session.exerciseLogs?.reduce((s, l) => s + (l.sets?.length ?? 0), 0) ?? 0;
  const totalDistanceKm =
    session.exerciseLogs?.reduce(
      (total, log) =>
        total +
        (log.sets
          ?.filter((set) => set.completedAt)
          .reduce((sum, set) => sum + (set.distanceKm ?? 0), 0) ?? 0),
      0,
    ) ?? 0;
  const pct = totalPlannedSets > 0 ? (completedSets / totalPlannedSets) * 100 : 0;

  if (showSummary && session.status === "completed") {
    return (
      <div className="flex min-h-full items-center justify-center p-8">
        <Card className="w-full max-w-md">
          <CardContent className="p-8 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-foreground text-background">
              <Check className="h-5 w-5" />
            </div>
            <h1 className="mb-1 text-xl font-bold text-foreground">Workout Complete</h1>
            <p className="mb-6 text-sm text-muted-foreground">Here&apos;s your summary.</p>

            <div
              className={cn(
                "mb-6 grid gap-4",
                totalDistanceKm > 0 ? "grid-cols-4" : "grid-cols-3",
              )}
            >
              <div>
                <p className="text-2xl font-bold text-foreground">{completedSets}</p>
                <p className="text-[11px] text-muted-foreground">Completed</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{(session.totalVolume ?? 0).toLocaleString()}</p>
                <p className="text-[11px] text-muted-foreground">kg lifted</p>
              </div>
              {totalDistanceKm > 0 && (
                <div>
                  <p className="text-2xl font-bold text-foreground">
                    {totalDistanceKm.toLocaleString()}
                  </p>
                  <p className="text-[11px] text-muted-foreground">km run</p>
                </div>
              )}
              <div>
                <p className="text-2xl font-bold text-foreground">{fmtLong(elapsed)}</p>
                <p className="text-[11px] text-muted-foreground">Duration</p>
              </div>
            </div>

            <div className="mb-6 space-y-1.5">
              {session.exerciseLogs?.map((log) => {
                const logSets = log.sets?.filter((s) => s.completedAt) ?? [];
                const vol = logSets.reduce((s, set) => s + (set.weight ?? 0) * (set.reps ?? 0), 0);
                const distance = logSets.reduce(
                  (sum, set) => sum + (set.distanceKm ?? 0),
                  0,
                );
                const duration = logSets.reduce(
                  (sum, set) => sum + (set.durationMinutes ?? 0),
                  0,
                );
                const isRun = log.trackingType === "run";
                return (
                  <div key={log.id} className="flex items-center justify-between rounded-md bg-muted p-3">
                    <div className="text-left">
                      <p className="text-[13px] font-medium text-foreground">{log.exerciseName}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {isRun
                          ? `${distance} km · ${duration} min`
                          : `${logSets.length} sets`}
                      </p>
                    </div>
                    <span className="text-sm font-semibold text-foreground">
                      {isRun
                        ? formatPace(
                            distance > 0 && duration > 0
                              ? duration / distance
                              : null,
                          )
                        : `${vol.toLocaleString()} kg`}
                    </span>
                  </div>
                );
              })}
            </div>

            <Link to="/workouts">
              <Button className="w-full">Back to Fitness</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-border px-4 py-3 sm:px-6">
        <div className="flex items-center justify-between">
          <Link to="/workouts" className="flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </Link>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-sm font-mono font-medium text-foreground">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              {fmt(elapsed)}
            </span>
            <Button size="sm" variant="outline" onClick={() => finishMutation.mutate()} disabled={finishMutation.isPending}>
              Finish
            </Button>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-3">
          {/* Progress ring */}
          <div className="relative h-10 w-10 shrink-0">
            <svg className="h-10 w-10 -rotate-90" viewBox="0 0 40 40">
              <circle cx="20" cy="20" r="16" fill="none" stroke="currentColor" strokeWidth="3" className="text-muted" />
              <circle cx="20" cy="20" r="16" fill="none" stroke="currentColor" strokeWidth="3"
                strokeDasharray={`${2 * Math.PI * 16}`} strokeDashoffset={`${2 * Math.PI * 16 * (1 - pct / 100)}`} strokeLinecap="round" className="text-foreground transition-all duration-500" />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-foreground">
              {Math.round(pct)}%
            </span>
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">{completedSets} / {totalPlannedSets} completed</p>
            <p className="text-[11px] text-muted-foreground">
              {(session.totalVolume ?? 0).toLocaleString()} kg
              {totalDistanceKm > 0 ? ` · ${totalDistanceKm} km` : ""}
            </p>
          </div>
        </div>
      </div>

      {/* Exercises */}
      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <div className="mx-auto max-w-2xl space-y-3">
          {session.exerciseLogs?.map((log) => (
            <ExerciseLogCard key={log.id} log={log} sessionId={sessionId} onSetComplete={startRest} />
          ))}
        </div>
      </div>

      {/* Rest timer */}
      {restTimer !== null && (
        <div className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background p-4 shadow-lg sm:inset-x-auto sm:bottom-6 sm:left-1/2 sm:max-w-xs sm:-translate-x-1/2 sm:rounded-lg sm:border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Timer className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">Rest</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xl font-bold tabular-nums text-foreground">{restTimer}s</span>
              <Button size="sm" variant="ghost" onClick={() => setRestTimer(null)}>Skip</Button>
            </div>
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-foreground transition-all duration-1000"
              style={{
                width: `${Math.min(
                  100,
                  (restTimer / preferences.restTimerSeconds) * 100,
                )}%`,
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ExerciseLogCard({
  log,
  sessionId,
  onSetComplete,
}: {
  log: SessionExerciseLog;
  sessionId: string;
  onSetComplete: () => void;
}) {
  const queryClient = useQueryClient();
  const isRun = log.trackingType === "run";
  const lastSet = log.sets?.filter((set) => set.completedAt).at(-1);
  const [weight, setWeight] = useState(
    lastSet?.weight ?? log.sets?.[0]?.weight ?? 0,
  );
  const [reps, setReps] = useState(
    lastSet?.reps ?? log.sets?.[0]?.reps ?? 10,
  );
  const [distanceKm, setDistanceKm] = useState(
    lastSet?.distanceKm ?? log.sets?.[0]?.distanceKm ?? 5,
  );
  const [durationMinutes, setDurationMinutes] = useState(
    lastSet?.durationMinutes ?? log.sets?.[0]?.durationMinutes ?? 30,
  );

  const logSetMutation = useMutation({
    mutationFn: (
      data:
        | { weight: number; reps: number }
        | { distanceKm: number; durationMinutes: number },
    ) =>
      api.post(
        `/api/workouts/sessions/${sessionId}/logs/${log.id}/sets`,
        data,
      ),
    onSuccess: () => {
      if (!isRun) onSetComplete();
      queryClient.invalidateQueries({
        queryKey: queryKeys.workoutSessions.detail(sessionId),
      });
    },
  });

  const completedSets = log.sets?.filter((set) => set.completedAt) ?? [];
  const totalSets = log.sets?.length ?? 0;
  const isComplete = completedSets.length >= totalSets && totalSets > 0;

  return (
    <Card className={cn(isComplete && "border-foreground/20")}>
      <CardContent className="p-0">
        <div
          className={cn(
            "flex items-center gap-2.5 p-4",
            isComplete && "bg-muted/30",
          )}
        >
          <div
            className={cn(
              "flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
              isComplete
                ? "bg-foreground text-background"
                : "bg-muted text-muted-foreground",
            )}
          >
            {isComplete ? (
              <Check className="h-3 w-3" />
            ) : isRun ? (
              <MapPin className="h-3 w-3" />
            ) : (
              <Dumbbell className="h-3 w-3" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-foreground">
              {log.exerciseName}
            </p>
          </div>
          <Badge variant="secondary" className="text-[10px]">
            {isRun
              ? isComplete
                ? "Run logged"
                : "Run planned"
              : `${completedSets.length}/${totalSets}`}
          </Badge>
        </div>

        {log.sets?.map((set) => (
          <div
            key={set.id}
            className={cn(
              "flex items-center justify-between border-t border-border px-4 py-2",
              set.completedAt && "bg-muted/20",
            )}
          >
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-medium",
                  set.completedAt
                    ? "bg-foreground text-background"
                    : "text-muted-foreground",
                )}
              >
                {set.completedAt ? (
                  <Check className="h-2.5 w-2.5" />
                ) : (
                  set.setNumber
                )}
              </span>
              <span className="text-[12px] text-muted-foreground">
                {isRun ? "Run" : `Set ${set.setNumber}`}
              </span>
            </div>
            <span className="text-[13px] font-medium text-foreground">
              {isRun
                ? `${set.distanceKm ?? "—"} km · ${
                    set.durationMinutes ?? "—"
                  } min`
                : `${set.weight ?? "—"} kg × ${set.reps ?? "—"}`}
            </span>
          </div>
        ))}

        {!isComplete &&
          (isRun ? (
            <div className="grid gap-2 border-t border-border bg-muted/20 p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <label>
                <span className="mb-1 block text-[10px] text-muted-foreground">
                  Distance (km)
                </span>
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={distanceKm}
                  onChange={(event) =>
                    setDistanceKm(Math.max(0.1, Number(event.target.value)))
                  }
                  className="h-8 w-full rounded border border-border bg-background px-2 text-[12px]"
                />
              </label>
              <label>
                <span className="mb-1 block text-[10px] text-muted-foreground">
                  Time (minutes)
                </span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={durationMinutes}
                  onChange={(event) =>
                    setDurationMinutes(
                      Math.max(1, Number(event.target.value)),
                    )
                  }
                  className="h-8 w-full rounded border border-border bg-background px-2 text-[12px]"
                />
              </label>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  logSetMutation.mutate({ distanceKm, durationMinutes })
                }
                disabled={logSetMutation.isPending}
                className="gap-1"
              >
                <Check className="h-3 w-3" />
                Log run
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2 border-t border-border bg-muted/20 p-3">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setWeight(Math.max(0, weight - 2.5))}
                  className="flex h-6 w-6 items-center justify-center rounded border border-border text-muted-foreground hover:text-foreground"
                >
                  &minus;
                </button>
                <input
                  type="number"
                  value={weight}
                  onChange={(event) => setWeight(Number(event.target.value))}
                  className="w-12 rounded border border-border bg-background px-1 py-1 text-center text-[12px]"
                />
                <button
                  onClick={() => setWeight(weight + 2.5)}
                  className="flex h-6 w-6 items-center justify-center rounded border border-border text-muted-foreground hover:text-foreground"
                >
                  +
                </button>
                <span className="text-[10px] text-muted-foreground">kg</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setReps(Math.max(1, reps - 1))}
                  className="flex h-6 w-6 items-center justify-center rounded border border-border text-muted-foreground hover:text-foreground"
                >
                  &minus;
                </button>
                <input
                  type="number"
                  value={reps}
                  onChange={(event) => setReps(Number(event.target.value))}
                  className="w-10 rounded border border-border bg-background px-1 py-1 text-center text-[12px]"
                />
                <button
                  onClick={() => setReps(reps + 1)}
                  className="flex h-6 w-6 items-center justify-center rounded border border-border text-muted-foreground hover:text-foreground"
                >
                  +
                </button>
                <span className="text-[10px] text-muted-foreground">reps</span>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => logSetMutation.mutate({ weight, reps })}
                disabled={logSetMutation.isPending}
                className="ml-auto gap-1"
              >
                <Check className="h-3 w-3" />
                Log
              </Button>
            </div>
          ))}
      </CardContent>
    </Card>
  );
}

function formatPace(minutesPerKm: number | null) {
  if (!minutesPerKm || !Number.isFinite(minutesPerKm)) return "—";
  const totalSeconds = Math.round(minutesPerKm * 60);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")} /km`;
}
