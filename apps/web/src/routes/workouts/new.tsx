import {
  createFileRoute,
  Link,
  useNavigate,
} from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  ArrowLeft,
  Dumbbell,
  History,
  ImageOff,
  Layers3,
  MapPin,
  Plus,
  Search,
  Sparkles,
  Timer,
  Trophy,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import {
  queryKeys,
  type Exercise,
  type ExercisePerformance,
  type ExercisePerformanceSet,
  type WorkoutGroup,
} from "@/lib/query-keys";
import {
  EXERCISE_CATEGORIES,
  POPULAR_EXERCISE_NAMES,
  getExerciseImageCandidates,
} from "@/lib/exercise-data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppPreferences } from "@/lib/preferences";
import { cn } from "@/lib/utils";
import { ExerciseImage } from "@/components/workouts/exercise-image";
import { CreateExerciseDialog } from "@/components/workouts/create-exercise-dialog";

export const Route = createFileRoute("/workouts/new")({
  component: NewGroupPage,
});

interface SelectedExercise extends Exercise {
  sets: number;
  reps: number;
  weight: number;
  distanceKm: number;
  durationMinutes: number;
}

function formatSet(
  set:
    | ExercisePerformanceSet
    | ExercisePerformance["bestSet"]
    | undefined,
) {
  if (!set) return "No sets yet";
  if ((set.distanceKm ?? 0) > 0) {
    return `${set.distanceKm} km${
      (set.durationMinutes ?? 0) > 0 ? ` · ${set.durationMinutes} min` : ""
    }`;
  }
  const reps = set.reps ?? 0;
  return (set.weight ?? 0) > 0
    ? `${set.weight} kg × ${reps}`
    : `${reps} reps`;
}

function formatPace(minutesPerKm?: number | null) {
  if (!minutesPerKm || !Number.isFinite(minutesPerKm)) return "—";
  const totalSeconds = Math.round(minutesPerKm * 60);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")} /km`;
}

function NewGroupPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { preferences } = useAppPreferences();
  const [name, setName] = useState("");
  const [targetDays, setTargetDays] = useState("");
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [selected, setSelected] = useState<SelectedExercise[]>([]);

  const {
    data: exercises,
    isLoading: exercisesLoading,
    isError: exercisesError,
  } = useQuery({
    queryKey: queryKeys.exercises.all,
    queryFn: () => api.get<Exercise[]>("/api/exercises"),
    staleTime: 600_000,
    gcTime: 1_800_000,
  });

  const exerciseIds = useMemo(
    () => exercises?.map((exercise) => exercise.id) ?? [],
    [exercises],
  );

  const { data: performance = [], isLoading: performanceLoading } = useQuery({
    queryKey: queryKeys.workoutPerformance.byExercises(exerciseIds),
    queryFn: () =>
      api.get<ExercisePerformance[]>(
        `/api/workouts/performance?exerciseIds=${encodeURIComponent(
          exerciseIds.join(","),
        )}`,
      ),
    enabled: exerciseIds.length > 0,
    staleTime: 60_000,
    gcTime: 600_000,
  });

  const performanceByExercise = useMemo(
    () =>
      new Map(
        performance.map((exercisePerformance) => [
          exercisePerformance.exerciseId,
          exercisePerformance,
        ]),
      ),
    [performance],
  );

  const filteredExercises = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return (exercises ?? []).filter((exercise) => {
      const matchesSearch =
        !normalizedSearch ||
        exercise.name.toLowerCase().includes(normalizedSearch) ||
        exercise.equipmentType
          .replace("_", " ")
          .toLowerCase()
          .includes(normalizedSearch);
      const matchesCategory =
        !activeCategory || exercise.category === activeCategory;
      return matchesSearch && matchesCategory;
    });
  }, [activeCategory, exercises, search]);

  const popularExercises = useMemo(
    () =>
      (exercises ?? []).filter((exercise) =>
        POPULAR_EXERCISE_NAMES.includes(exercise.name),
      ),
    [exercises],
  );
  const runExercise = useMemo(
    () =>
      (exercises ?? []).find((exercise) => exercise.name === "Outdoor Run") ??
      (exercises ?? []).find((exercise) => exercise.trackingType === "run"),
    [exercises],
  );

  function isSelected(exerciseId: string) {
    return selected.some((exercise) => exercise.id === exerciseId);
  }

  function addExercise(exercise: Exercise) {
    if (isSelected(exercise.id)) return;
    const previous = performanceByExercise.get(exercise.id)?.previousWorkout;
    const lastSet = previous?.sets.at(-1);
    setSelected((current) => [
      ...current,
      {
        ...exercise,
        sets: Math.max(
          previous?.sets.length ?? preferences.defaultSets,
          1,
        ),
        reps: Math.max(lastSet?.reps ?? preferences.defaultReps, 1),
        weight: Math.max(lastSet?.weight ?? 0, 0),
        distanceKm:
          exercise.trackingType === "run"
            ? Math.max(lastSet?.distanceKm ?? 5, 0.1)
            : 0,
        durationMinutes:
          exercise.trackingType === "run"
            ? Math.max(lastSet?.durationMinutes ?? 30, 1)
            : 0,
      },
    ]);
  }

  function removeExercise(exerciseId: string) {
    setSelected((current) =>
      current.filter((exercise) => exercise.id !== exerciseId),
    );
  }

  function updateExercise(
    exerciseId: string,
    field: "sets" | "reps" | "weight" | "distanceKm" | "durationMinutes",
    value: number,
  ) {
    const minimum =
      field === "weight"
        ? 0
        : field === "distanceKm"
          ? 0.1
          : 1;
    setSelected((current) =>
      current.map((exercise) =>
        exercise.id === exerciseId
          ? { ...exercise, [field]: Math.max(value || minimum, minimum) }
          : exercise,
      ),
    );
  }

  function usePreviousPerformance(exerciseId: string) {
    const previous =
      performanceByExercise.get(exerciseId)?.previousWorkout?.sets ?? [];
    if (previous.length === 0) return;
    const lastSet = previous.at(-1);
    setSelected((current) =>
      current.map((exercise) =>
        exercise.id === exerciseId
          ? {
              ...exercise,
              sets: previous.length,
              reps: Math.max(lastSet?.reps ?? exercise.reps, 1),
              weight: Math.max(lastSet?.weight ?? exercise.weight, 0),
              distanceKm: Math.max(
                lastSet?.distanceKm ?? exercise.distanceKm,
                0.1,
              ),
              durationMinutes: Math.max(
                lastSet?.durationMinutes ?? exercise.durationMinutes,
                1,
              ),
            }
          : exercise,
      ),
    );
  }

  const totalSets = selected.reduce(
    (total, exercise) =>
      total + (exercise.trackingType === "run" ? 0 : exercise.sets),
    0,
  );
  const estimatedVolume = selected.reduce(
    (total, exercise) =>
      total + exercise.sets * exercise.reps * exercise.weight,
    0,
  );
  const totalDistanceKm = selected.reduce(
    (total, exercise) =>
      total +
      (exercise.trackingType === "run" ? exercise.distanceKm : 0),
    0,
  );
  const totalRunMinutes = selected.reduce(
    (total, exercise) =>
      total +
      (exercise.trackingType === "run" ? exercise.durationMinutes : 0),
    0,
  );

  const createMutation = useMutation({
    mutationFn: (data: unknown) =>
      api.post<WorkoutGroup>("/api/workouts/groups", data),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.workoutGroups.all,
      });
      navigate({ to: "/workouts" });
    },
  });

  function handleSave() {
    if (!name.trim() || selected.length === 0) return;
    createMutation.mutate({
      name: name.trim(),
      targetDays: targetDays.trim() || null,
      exercises: selected.map((exercise, position) => ({
        exerciseId: exercise.id,
        position,
        defaultSets: exercise.sets,
        defaultReps: exercise.reps,
        defaultWeight: exercise.weight,
        defaultDistanceKm:
          exercise.trackingType === "run"
            ? exercise.distanceKm
            : undefined,
        defaultDurationMinutes:
          exercise.trackingType === "run"
            ? exercise.durationMinutes
            : undefined,
      })),
    });
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#fafafa]">
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <Link
            to="/workouts"
            className="flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Workouts
          </Link>
          <div className="text-center">
            <p className="text-sm font-semibold text-foreground">
              Build a workout
            </p>
            <p className="hidden text-[10px] text-muted-foreground sm:block">
              Add exercises, then set your working targets
            </p>
          </div>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={
              !name.trim() ||
              selected.length === 0 ||
              createMutation.isPending
            }
            className="min-w-20"
          >
            {createMutation.isPending ? "Saving…" : "Save workout"}
          </Button>
        </div>
      </header>

      <main className="flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto max-w-6xl">
          <section className="mb-6 rounded-xl border border-border bg-background p-4 sm:p-5">
            <div className="mb-4 flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-foreground text-background">
                <Layers3 className="h-4 w-4" />
              </div>
              <div>
                <h1 className="text-base font-semibold tracking-tight text-foreground">
                  Start with your workout details
                </h1>
                <p className="mt-0.5 text-[12px] text-muted-foreground">
                  You can adjust every exercise target before saving.
                </p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="workout-name"
                  className="mb-1.5 block text-[11px] font-semibold text-foreground"
                >
                  Workout name
                </label>
                <Input
                  id="workout-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="e.g. Push day"
                  autoFocus
                />
              </div>
              <div>
                <label
                  htmlFor="training-days"
                  className="mb-1.5 block text-[11px] font-semibold text-foreground"
                >
                  Training days{" "}
                  <span className="font-normal text-muted-foreground">
                    (optional)
                  </span>
                </label>
                <Input
                  id="training-days"
                  value={targetDays}
                  onChange={(event) => setTargetDays(event.target.value)}
                  placeholder="e.g. Mon, Thu"
                />
              </div>
            </div>
          </section>

          <div className="grid items-start gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
            <aside className="rounded-xl border border-border bg-background lg:sticky lg:top-24">
              <div className="border-b border-border p-4">
                <div className="mb-3">
                  <h2 className="text-sm font-semibold text-foreground">
                    1. Select exercises
                  </h2>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Search or choose a popular movement.
                  </p>
                </div>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search exercises or equipment"
                    className="pl-9"
                  />
                </div>
                <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
                  <button
                    type="button"
                    onClick={() => setActiveCategory(null)}
                    className={cn(
                      "shrink-0 rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors",
                      activeCategory === null
                        ? "bg-foreground text-background"
                        : "bg-muted text-muted-foreground hover:text-foreground",
                    )}
                  >
                    All
                  </button>
                  {Object.entries(EXERCISE_CATEGORIES)
                    .sort(([, a], [, b]) => a.order - b.order)
                    .map(([key, category]) => (
                      <button
                        type="button"
                        key={key}
                        onClick={() =>
                          setActiveCategory(
                            activeCategory === key ? null : key,
                          )
                        }
                        className={cn(
                          "shrink-0 rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors",
                          activeCategory === key
                            ? "bg-foreground text-background"
                            : "bg-muted text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {category.label}
                      </button>
                    ))}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {runExercise ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={isSelected(runExercise.id)}
                      onClick={() => addExercise(runExercise)}
                      className="w-full"
                    >
                      <MapPin className="h-3.5 w-3.5" />
                      {isSelected(runExercise.id) ? "Run added" : "Add a run"}
                    </Button>
                  ) : (
                    <CreateExerciseDialog
                      initialName="Outdoor Run"
                      initialTrackingType="run"
                      triggerLabel="Add a run"
                      className="w-full bg-muted"
                      onCreated={addExercise}
                    />
                  )}
                  <CreateExerciseDialog
                    initialName={search}
                    triggerLabel="New exercise"
                    className="w-full"
                    onCreated={addExercise}
                  />
                </div>
              </div>

              {!search && !activeCategory && popularExercises.length > 0 && (
                <div className="border-b border-border px-4 py-3">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Popular
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {popularExercises.slice(0, 5).map((exercise) => (
                      <button
                        type="button"
                        key={exercise.id}
                        disabled={isSelected(exercise.id)}
                        onClick={() => addExercise(exercise)}
                        className="rounded-md border border-border px-2 py-1 text-[10px] font-medium text-foreground hover:bg-muted disabled:bg-muted disabled:text-muted-foreground"
                      >
                        {isSelected(exercise.id) ? "Added · " : "+ "}
                        {exercise.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="max-h-[58vh] overflow-y-auto p-2">
                {exercisesLoading ? (
                  <div className="space-y-2 p-2">
                    {Array.from({ length: 6 }).map((_, index) => (
                      <Skeleton key={index} className="h-16 w-full rounded-lg" />
                    ))}
                  </div>
                ) : exercisesError ? (
                  <div className="p-8 text-center">
                    <Dumbbell className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
                    <p className="text-[12px] text-muted-foreground">
                      Exercise library could not be loaded.
                    </p>
                  </div>
                ) : filteredExercises.length === 0 ? (
                  <div className="p-8 text-center">
                    <Search className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
                    <p className="text-[12px] text-muted-foreground">
                      No exercises match your search.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {filteredExercises.map((exercise) => {
                      const exercisePerformance =
                        performanceByExercise.get(exercise.id);
                      return (
                        <button
                          type="button"
                          key={exercise.id}
                          disabled={isSelected(exercise.id)}
                          onClick={() => addExercise(exercise)}
                          className="group flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-muted disabled:cursor-default disabled:bg-muted/60"
                        >
                          <ExerciseThumbnail name={exercise.name} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[12px] font-semibold text-foreground">
                              {exercise.name}
                            </span>
                            <span className="block truncate text-[10px] capitalize text-muted-foreground">
                              {exercise.equipmentType.replaceAll("_", " ")}
                            </span>
                            {exercisePerformance?.previousWorkout && (
                              <span className="mt-0.5 block truncate text-[9px] font-medium text-foreground/65">
                                Last ·{" "}
                                {formatSet(
                                  exercisePerformance.previousWorkout.sets.at(
                                    -1,
                                  ),
                                )}
                              </span>
                            )}
                          </span>
                          <span
                            className={cn(
                              "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground group-hover:border-foreground group-hover:text-foreground",
                              isSelected(exercise.id) &&
                                "border-foreground bg-foreground text-background",
                            )}
                          >
                            {isSelected(exercise.id) ? (
                              <span className="text-xs">✓</span>
                            ) : (
                              <Plus className="h-3.5 w-3.5" />
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </aside>

            <section>
              <div className="mb-3 flex items-end justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">
                    2. Set exercise targets
                  </h2>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Previous results are shown beside each exercise.
                  </p>
                </div>
                <Badge variant="secondary">
                      {selected.length} exercise{selected.length === 1 ? "" : "s"}
                </Badge>
              </div>

              {selected.length === 0 ? (
                <div className="flex min-h-80 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-background p-8 text-center">
                  <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-muted">
                    <Plus className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <p className="text-sm font-semibold text-foreground">
                    Add your first exercise
                  </p>
                  <p className="mt-1 max-w-xs text-[12px] leading-relaxed text-muted-foreground">
                    Choose an exercise or add a run. Its targets, previous
                    workout, and personal best will appear here.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {selected.map((exercise, index) => (
                    <SelectedExerciseCard
                      key={exercise.id}
                      exercise={exercise}
                      index={index}
                      performance={performanceByExercise.get(exercise.id)}
                      performanceLoading={performanceLoading}
                      overloadIncrement={preferences.overloadIncrement}
                      onRemove={() => removeExercise(exercise.id)}
                      onUpdate={(field, value) =>
                        updateExercise(exercise.id, field, value)
                      }
                      onUsePrevious={() =>
                        usePreviousPerformance(exercise.id)
                      }
                    />
                  ))}
                </div>
              )}

              {selected.length > 0 && (
                <div className="mt-4 flex flex-col gap-3 rounded-xl border border-border bg-background p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex gap-6">
                    {totalSets > 0 && (
                      <>
                        <div>
                          <p className="text-lg font-bold tabular-nums text-foreground">
                            {totalSets}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            planned strength sets
                          </p>
                        </div>
                        <div>
                          <p className="text-lg font-bold tabular-nums text-foreground">
                            {estimatedVolume > 0
                              ? `${estimatedVolume.toLocaleString()} kg`
                              : "Bodyweight"}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            estimated volume
                          </p>
                        </div>
                      </>
                    )}
                    {totalDistanceKm > 0 && (
                      <div>
                        <p className="text-lg font-bold tabular-nums text-foreground">
                          {totalDistanceKm.toLocaleString()} km
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          planned · {totalRunMinutes} min
                        </p>
                      </div>
                    )}
                  </div>
                  <Button
                    onClick={handleSave}
                    disabled={!name.trim() || createMutation.isPending}
                  >
                    {createMutation.isPending
                      ? "Saving workout…"
                      : "Save workout"}
                  </Button>
                </div>
              )}

              {createMutation.isError && (
                <p className="mt-3 rounded-lg bg-red-50 p-3 text-[12px] text-red-700">
                  The workout could not be saved. Please check the exercise
                  values and try again.
                </p>
              )}
            </section>
          </div>

          <p className="mt-8 text-center text-[10px] text-muted-foreground">
            Exercise demonstrations from{" "}
            <a
              href="https://github.com/yuhonas/free-exercise-db"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              Free Exercise DB
            </a>
            , released to the public domain.
          </p>
        </div>
      </main>
    </div>
  );
}

function SelectedExerciseCard({
  exercise,
  index,
  performance,
  performanceLoading,
  overloadIncrement,
  onRemove,
  onUpdate,
  onUsePrevious,
}: {
  exercise: SelectedExercise;
  index: number;
  performance?: ExercisePerformance;
  performanceLoading: boolean;
  overloadIncrement: number;
  onRemove: () => void;
  onUpdate: (
    field: "sets" | "reps" | "weight" | "distanceKm" | "durationMinutes",
    value: number,
  ) => void;
  onUsePrevious: () => void;
}) {
  const previous = performance?.previousWorkout;
  const latestSet = previous?.sets.at(-1);
  const isRun = exercise.trackingType === "run";
  const suggestedProgression = isRun
    ? latestSet
      ? `Last run: ${formatSet(latestSet)}. Add a little distance or aim for a steadier pace.`
      : "Log this run once to start tracking distance and pace."
    : latestSet && (latestSet.weight ?? 0) > 0
      ? `Next target: ${
          Math.round(
            ((latestSet.weight ?? 0) + overloadIncrement) * 100,
          ) / 100
        } kg or ${(latestSet.reps ?? 0) + 1} reps`
      : latestSet
        ? `Next target: ${(latestSet.reps ?? 0) + 1} reps`
        : "Complete this workout once to unlock progression targets.";

  return (
    <article className="overflow-hidden rounded-xl border border-border bg-background">
      <div className="flex items-start gap-3 border-b border-border p-4">
        <ExerciseFrames name={exercise.name} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Exercise {index + 1}
              </p>
              <h3 className="mt-0.5 text-sm font-semibold text-foreground">
                {exercise.name}
              </h3>
              <p className="text-[10px] capitalize text-muted-foreground">
                {EXERCISE_CATEGORIES[exercise.category]?.label ??
                  exercise.category}{" "}
                · {exercise.equipmentType.replaceAll("_", " ")}
              </p>
            </div>
            <button
              type="button"
              aria-label={`Remove ${exercise.name}`}
              onClick={onRemove}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 px-2.5 py-2 text-amber-900">
            <Sparkles className="mt-0.5 h-3 w-3 shrink-0" />
            <p className="text-[10px] font-medium leading-4">
              {suggestedProgression}
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_240px]">
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Working target
          </p>
          {isRun ? (
            <div className="grid grid-cols-2 gap-2">
              <TargetInput
                label="Distance (km)"
                value={exercise.distanceKm}
                min={0.1}
                step={0.1}
                onChange={(value) => onUpdate("distanceKm", value)}
              />
              <TargetInput
                label="Duration (min)"
                value={exercise.durationMinutes}
                min={1}
                step={1}
                onChange={(value) => onUpdate("durationMinutes", value)}
              />
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              <TargetInput
                label="Sets"
                value={exercise.sets}
                min={1}
                step={1}
                onChange={(value) => onUpdate("sets", value)}
              />
              <TargetInput
                label="Reps / set"
                value={exercise.reps}
                min={1}
                step={1}
                onChange={(value) => onUpdate("reps", value)}
              />
              <TargetInput
                label="Weight (kg)"
                value={exercise.weight}
                min={0}
                step={2.5}
                onChange={(value) => onUpdate("weight", value)}
              />
            </div>
          )}
          <p className="mt-2 text-[10px] text-muted-foreground">
            {isRun
              ? `This plans a ${exercise.distanceKm} km run in about ${exercise.durationMinutes} minutes.`
              : `This creates ${exercise.sets} planned set${
                  exercise.sets === 1 ? "" : "s"
                } of ${exercise.reps} reps${
                  exercise.weight > 0 ? ` at ${exercise.weight} kg` : ""
                }.`}
          </p>
        </div>

        <div className="rounded-lg border border-border bg-muted/20 p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Progress
            </p>
            {previous && (
              <button
                type="button"
                onClick={onUsePrevious}
                className="text-[10px] font-semibold text-foreground underline underline-offset-2"
              >
                Use last
              </button>
            )}
          </div>
          {performanceLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : previous || performance?.bestSet || performance?.maxDistanceKm ? (
            <div className="space-y-2">
              <div className="flex items-start gap-2">
                <History className="mt-0.5 h-3.5 w-3.5 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="text-[9px] font-medium text-muted-foreground">
                    {isRun ? "Previous run" : "Previous workout"}
                  </p>
                  <p className="truncate text-[11px] font-semibold text-foreground">
                    {previous
                      ? previous.sets.map(formatSet).join(" · ")
                      : "No previous workout"}
                  </p>
                </div>
              </div>
              {isRun ? (
                <div className="flex items-start gap-2">
                  <Timer className="mt-0.5 h-3.5 w-3.5 text-amber-600" />
                  <div>
                    <p className="text-[9px] font-medium text-muted-foreground">
                      Running bests
                    </p>
                    <p className="text-[11px] font-semibold text-foreground">
                      {performance?.maxDistanceKm ?? "—"} km ·{" "}
                      {formatPace(performance?.fastestPaceMinPerKm)}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2">
                  <Trophy className="mt-0.5 h-3.5 w-3.5 text-amber-600" />
                  <div>
                    <p className="text-[9px] font-medium text-muted-foreground">
                      Best set
                    </p>
                    <p className="text-[11px] font-semibold text-foreground">
                      {formatSet(performance?.bestSet)}
                    </p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="py-2 text-center">
              {isRun ? (
                <MapPin className="mx-auto mb-1.5 h-4 w-4 text-muted-foreground" />
              ) : (
                <Dumbbell className="mx-auto mb-1.5 h-4 w-4 text-muted-foreground" />
              )}
              <p className="text-[10px] text-muted-foreground">
                No performance history yet.
              </p>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function TargetInput({
  label,
  value,
  min,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label>
      <span className="mb-1 block text-[10px] font-medium text-muted-foreground">
        {label}
      </span>
      <Input
        type="number"
        value={value}
        min={min}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-9 text-center text-sm font-semibold tabular-nums"
      />
    </label>
  );
}

function ExerciseThumbnail({ name }: { name: string }) {
  const hasImage = getExerciseImageCandidates(name, 0).length > 0;
  return (
    <span className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-white">
      <ImageOff className="h-4 w-4 text-muted-foreground/30" />
      {hasImage && (
        <ExerciseImage
          name={name}
          frame={0}
          alt={`${name} starting position`}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
    </span>
  );
}

function ExerciseFrames({ name }: { name: string }) {
  const hasImages = getExerciseImageCandidates(name, 0).length > 0;
  return (
    <div className="hidden h-24 w-40 shrink-0 grid-cols-2 overflow-hidden rounded-lg border border-border bg-white sm:grid">
      {hasImages ? (
        ([0, 1] as const).map((frame) => (
          <div
            key={frame}
            className={cn(
              "relative flex items-center justify-center overflow-hidden",
              frame > 0 && "border-l border-border",
            )}
          >
            <ImageOff className="h-4 w-4 text-muted-foreground/20" />
            <ExerciseImage
              name={name}
              frame={frame}
              alt={`${name} ${frame === 0 ? "starting" : "finishing"} position`}
              className="absolute inset-0 h-full w-full object-cover"
            />
            <span className="absolute bottom-1 left-1 rounded bg-black/55 px-1 py-0.5 text-[8px] font-medium text-white">
              {frame === 0 ? "Start" : "Finish"}
            </span>
          </div>
        ))
      ) : (
        <div className="col-span-2 flex items-center justify-center">
          <Dumbbell className="h-5 w-5 text-muted-foreground/30" />
        </div>
      )}
    </div>
  );
}
