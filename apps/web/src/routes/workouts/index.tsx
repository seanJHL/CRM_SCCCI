import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import {
  Dumbbell,
  BookOpen,
  Plus,
  Search,
  Play,
  Clock,
  Layers,
  MapPin,
} from "lucide-react";
import { api } from "@/lib/api";
import {
  queryKeys,
  type WorkoutGroup,
  type WeeklySummary,
  type Exercise,
  type GroupExercise,
  type WorkoutSession,
} from "@/lib/query-keys";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  STATIC_EXERCISES,
  EXERCISE_CATEGORIES,
  getExerciseImageCandidates,
} from "@/lib/exercise-data";
import { cn } from "@/lib/utils";
import { ExerciseImage } from "@/components/workouts/exercise-image";
import { CreateExerciseDialog } from "@/components/workouts/create-exercise-dialog";

export const Route = createFileRoute("/workouts/")({
  component: FitnessPage,
});

function FitnessPage() {
  return (
    <div className="px-4 py-8 sm:px-8 lg:px-12">
      <div className="page-header">
        <h1 className="page-title">Fitness</h1>
        <p className="page-subtitle">Workouts and exercise library.</p>
      </div>

      <Tabs defaultValue="workouts">
        <TabsList>
          <TabsTrigger value="workouts">
            <Dumbbell className="h-3.5 w-3.5" />
            Workouts
          </TabsTrigger>
          <TabsTrigger value="exercises">
            <BookOpen className="h-3.5 w-3.5" />
            Exercises
          </TabsTrigger>
        </TabsList>

        <TabsContent value="workouts">
          <WorkoutsTab />
        </TabsContent>
        <TabsContent value="exercises">
          <ExercisesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function WorkoutsTab() {
  const { data: groups, isLoading } = useQuery({
    queryKey: queryKeys.workoutGroups.all,
    queryFn: () => api.get<WorkoutGroup[]>("/api/workouts/groups"),
    staleTime: 120_000,
    gcTime: 600_000,
  });

  const { data: summary } = useQuery({
    queryKey: queryKeys.analytics.weeklySummary,
    queryFn: () => api.get<WeeklySummary>("/api/analytics/weekly-summary"),
    staleTime: 300_000,
    gcTime: 900_000,
  });

  return (
    <>
      {/* Weekly stats */}
      {summary && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Sessions", value: summary.exercise.sessions },
            { label: "Volume", value: `${(summary.exercise.volumeKg / 1000).toFixed(1)}k kg` },
            { label: "Sets", value: summary.exercise.totalSets },
            { label: "Streak", value: `${summary.exercise.weeksInRow} wks` },
          ].map((s) => (
            <div key={s.label} className="rounded-lg border border-border p-4">
              <p className="text-[11px] font-medium text-muted-foreground">{s.label}</p>
              <p className="mt-1 text-xl font-bold text-foreground">{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Groups */}
      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
        {isLoading
          ? Array.from({ length: 3 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-5">
                  <Skeleton className="mb-2 h-4 w-28" />
                  <Skeleton className="mb-3 h-3 w-16" />
                  <div className="flex gap-2">
                    <Skeleton className="h-5 w-14 rounded-md" />
                    <Skeleton className="h-5 w-14 rounded-md" />
                  </div>
                </CardContent>
              </Card>
            ))
          : groups?.map((g) => <WorkoutCard key={g.id} group={g} />)}

        <Link
          to="/workouts/new"
          className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border p-8 transition-colors hover:border-foreground/30 hover:bg-muted/30"
        >
          <Plus className="mb-2 h-5 w-5 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">New Group</span>
          <span className="mt-0.5 text-[11px] text-muted-foreground">Pick exercises together</span>
        </Link>
      </div>
    </>
  );
}

function WorkoutCard({ group }: { group: WorkoutGroup }) {
  const navigate = useNavigate();
  const { data: detail } = useQuery({
    queryKey: queryKeys.workoutGroups.detail(group.id),
    queryFn: () =>
      api.get<WorkoutGroup & { exercises: GroupExercise[] }>(
        `/api/workouts/groups/${group.id}`,
      ),
    staleTime: 120_000,
    gcTime: 600_000,
  });

  const exerciseCount = detail?.exercises?.length ?? 0;
  const totalSets =
    detail?.exercises?.reduce(
      (sum, exercise) =>
        sum +
        (exercise.trackingType === "run" ? 0 : exercise.defaultSets),
      0,
    ) ?? 0;
  const totalDistanceKm =
    detail?.exercises?.reduce(
      (sum, exercise) =>
        sum +
        (exercise.trackingType === "run"
          ? (exercise.defaultDistanceKm ?? 0)
          : 0),
      0,
    ) ?? 0;
  const estimatedMin =
    detail?.exercises?.reduce(
      (sum, exercise) =>
        sum +
        (exercise.trackingType === "run"
          ? (exercise.defaultDurationMinutes ?? 30)
          : 10),
      0,
    ) ?? exerciseCount * 10;
  const startMutation = useMutation({
    mutationFn: () =>
      api.post<WorkoutSession>(`/api/workouts/sessions/start/${group.id}`, {}),
    onSuccess: (session) =>
      navigate({
        to: "/workouts/$sessionId",
        params: { sessionId: session.id },
      }),
  });

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">{group.name}</h3>
            {group.targetDays && (
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                {group.targetDays}
              </p>
            )}
          </div>
          <Button
            size="sm"
            onClick={() => startMutation.mutate()}
            disabled={exerciseCount === 0 || startMutation.isPending}
            className="gap-1"
          >
            <Play className="h-3 w-3" />
            {startMutation.isPending ? "Starting…" : "Start"}
          </Button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge variant="secondary" className="gap-1">
            <Dumbbell className="h-3 w-3" />
            {exerciseCount}
          </Badge>
          {totalSets > 0 && (
            <Badge variant="secondary" className="gap-1">
              <Layers className="h-3 w-3" />
              {totalSets} sets
            </Badge>
          )}
          {totalDistanceKm > 0 && (
            <Badge variant="secondary" className="gap-1">
              <MapPin className="h-3 w-3" />
              {totalDistanceKm} km
            </Badge>
          )}
          <Badge variant="secondary" className="gap-1">
            <Clock className="h-3 w-3" />
            ~{estimatedMin}m
          </Badge>
        </div>

        <div className="mt-4 border-t border-border pt-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Exercise performance
            </p>
            <span className="text-[9px] text-muted-foreground">
              Personal best · previous workout
            </span>
          </div>
          {detail ? (
            detail.exercises.length > 0 ? (
            <div className="space-y-2">
              {detail.exercises.map((exercise) => (
                <GroupExercisePerformance
                  key={exercise.id}
                  exercise={exercise}
                />
              ))}
            </div>
            ) : (
              <p className="rounded-lg border border-dashed border-border p-4 text-center text-[10px] text-muted-foreground">
                No exercises in this workout yet.
              </p>
            )
          ) : (
            <div className="space-y-2">
              {Array.from({ length: Math.max(exerciseCount, 2) }).map(
                (_, index) => (
                  <Skeleton key={index} className="h-16 w-full rounded-lg" />
                ),
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function formatPerformanceSet(
  set?: { weight: number | null; reps: number | null } | null,
) {
  if (!set) return "—";
  return (set.weight ?? 0) > 0
    ? `${set.weight}kg × ${set.reps ?? 0}`
    : `${set.reps ?? 0} reps`;
}

function GroupExercisePerformance({
  exercise,
}: {
  exercise: GroupExercise;
}) {
  const hasImage =
    getExerciseImageCandidates(exercise.exerciseName, 0).length > 0;
  const previousSet = exercise.performance?.previousWorkout?.sets.at(-1);
  const isRun = exercise.trackingType === "run";

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/15 p-2">
      <div className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-white">
        <Dumbbell className="h-4 w-4 text-muted-foreground/25" />
        {hasImage && (
          <ExerciseImage
            name={exercise.exerciseName}
            frame={0}
            alt={`${exercise.exerciseName} starting position`}
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-[11px] font-semibold text-foreground">
            {exercise.exerciseName}
          </p>
          <span className="shrink-0 text-[9px] text-muted-foreground">
            {isRun
              ? `${exercise.defaultDistanceKm ?? "—"} km · ${
                  exercise.defaultDurationMinutes ?? "—"
                } min`
              : `${exercise.defaultSets} × ${exercise.defaultReps}${
                  exercise.defaultWeight
                    ? ` @ ${exercise.defaultWeight}kg`
                    : ""
                }`}
          </span>
        </div>
        {isRun ? (
          <div className="mt-1.5 grid grid-cols-3 gap-2">
            <PerformanceMetric
              label="Longest"
              value={
                exercise.performance?.maxDistanceKm
                  ? `${exercise.performance.maxDistanceKm} km`
                  : "—"
              }
            />
            <PerformanceMetric
              label="Best pace"
              value={formatPace(exercise.performance?.fastestPaceMinPerKm)}
            />
            <PerformanceMetric
              label="Previous"
              value={
                previousSet?.distanceKm
                  ? `${previousSet.distanceKm} km · ${
                      previousSet.durationMinutes ?? "—"
                    } min`
                  : "—"
              }
            />
          </div>
        ) : (
          <div className="mt-1.5 grid grid-cols-4 gap-2">
            <PerformanceMetric
              label="Max kg"
              value={exercise.performance?.maxWeight ?? "—"}
            />
            <PerformanceMetric
              label="Max reps"
              value={exercise.performance?.maxReps ?? "—"}
            />
            <PerformanceMetric
              label="Best set"
              value={formatPerformanceSet(exercise.performance?.bestSet)}
            />
            <PerformanceMetric
              label="Previous"
              value={formatPerformanceSet(previousSet)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function PerformanceMetric({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[8px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="truncate text-[10px] font-semibold text-foreground">
        {value}
      </p>
    </div>
  );
}

function formatPace(minutesPerKm?: number | null) {
  if (!minutesPerKm || !Number.isFinite(minutesPerKm)) return "—";
  const totalSeconds = Math.round(minutesPerKm * 60);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")} /km`;
}

function ExercisesTab() {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const { data: apiExercises } = useQuery({
    queryKey: queryKeys.exercises.all,
    queryFn: () => api.get<Exercise[]>("/api/exercises"),
    staleTime: 600_000,
    gcTime: 1_800_000,
  });

  const allExercises = useMemo(() => {
    const map = new Map<
      string,
      {
        id: string;
        name: string;
        category: string;
        equipmentType: string;
        trackingType: "strength" | "run";
      }
    >();
    STATIC_EXERCISES.forEach((exercise) =>
      map.set(exercise.name.toLowerCase(), {
        ...exercise,
        trackingType: exercise.trackingType ?? "strength",
      }),
    );
    apiExercises?.forEach((e) => map.set(e.name.toLowerCase(), e));
    return Array.from(map.values());
  }, [apiExercises]);

  const filtered = useMemo(() => {
    return allExercises.filter((e) => {
      const matchesSearch = !search || e.name.toLowerCase().includes(search.toLowerCase());
      const matchesCategory = !activeCategory || e.category === activeCategory;
      return matchesSearch && matchesCategory;
    });
  }, [allExercises, search, activeCategory]);

  const grouped = useMemo(() => {
    const sorted = Object.entries(EXERCISE_CATEGORIES).sort(([, a], [, b]) => a.order - b.order);
    return sorted
      .map(([key, meta]) => ({ key, label: meta.label, exercises: filtered.filter((e) => e.category === key) }))
      .filter((g) => g.exercises.length > 0);
  }, [filtered]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search..." className="pl-8" />
        </div>
        <CreateExerciseDialog initialName={search} />
      </div>

      <div className="flex flex-wrap gap-1">
        <Badge
          variant={activeCategory === null ? "default" : "secondary"}
          className="cursor-pointer"
          onClick={() => setActiveCategory(null)}
        >
          All
        </Badge>
        {Object.entries(EXERCISE_CATEGORIES)
          .sort(([, a], [, b]) => a.order - b.order)
          .map(([key, meta]) => (
            <Badge
              key={key}
              variant={activeCategory === key ? "default" : "secondary"}
              className="cursor-pointer"
              onClick={() => setActiveCategory(activeCategory === key ? null : key)}
            >
              {meta.label}
            </Badge>
          ))}
      </div>

      <p className="text-[11px] text-muted-foreground">{filtered.length} exercises</p>

      <div className="space-y-4">
        {grouped.map((g) => (
          <div key={g.key}>
            <p className="section-heading mb-2">{g.label}</p>
            <Card>
              {g.exercises.map((ex, i) => (
                <div
                  key={ex.id}
                  className={cn("flex items-center justify-between px-4 py-2.5", i > 0 && "border-t border-border")}
                >
                  <span className="text-[13px] text-foreground">{ex.name}</span>
                  <div className="flex items-center gap-1.5">
                    {ex.trackingType === "run" && (
                      <Badge variant="secondary" className="text-[10px]">
                        Run
                      </Badge>
                    )}
                    <Badge variant="outline" className="text-[10px]">
                      {ex.equipmentType.replaceAll("_", " ")}
                    </Badge>
                  </div>
                </div>
              ))}
            </Card>
          </div>
        ))}
      </div>
    </div>
  );
}
