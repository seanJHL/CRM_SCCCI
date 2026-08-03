import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, format, startOfDay } from "date-fns";
import { useMemo, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  Activity,
  BookOpen,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  Dumbbell,
  Flame,
  Medal,
  Play,
  Plus,
  Search,
  Trash2,
  TrendingUp,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import {
  queryKeys,
  type Exercise,
  type ExercisePerformance,
  type GroupExercise,
  type WeeklySummary,
  type WorkoutGroup,
  type WorkoutSession,
} from "@/lib/query-keys";
import { MobileErrorState } from "@/components/mobile/error-state";
import { notify } from "@/components/mobile/notification-banner";
import { ExerciseImage } from "@/components/workouts/exercise-image";
import { EXERCISE_CATEGORIES } from "@/lib/exercise-data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/m/workouts/")({
  component: MobileWorkouts,
});

type BuilderExercise = Exercise & {
  sets: number;
  reps: number;
  weight: number;
  distanceKm: number;
  durationMinutes: number;
};

const TRAINING_DAYS = [
  { short: "Mon", label: "Monday", day: 1 },
  { short: "Tue", label: "Tuesday", day: 2 },
  { short: "Wed", label: "Wednesday", day: 3 },
  { short: "Thu", label: "Thursday", day: 4 },
  { short: "Fri", label: "Friday", day: 5 },
  { short: "Sat", label: "Saturday", day: 6 },
  { short: "Sun", label: "Sunday", day: 0 },
] as const;

function upcomingTrainingDates(days: number[], count = 4) {
  if (days.length === 0) return [];
  const dates: Date[] = [];
  const today = startOfDay(new Date());
  for (let offset = 0; offset < 42 && dates.length < count; offset += 1) {
    const date = addDays(today, offset);
    if (days.includes(date.getDay())) dates.push(date);
  }
  return dates;
}

function parseTrainingDays(value: string | null) {
  if (!value) return [];
  const selected = value
    .split(",")
    .map((day) => day.trim().slice(0, 3).toLowerCase());
  return TRAINING_DAYS.filter((day) =>
    selected.includes(day.short.toLowerCase()),
  ).map((day) => day.day);
}

function MobileWorkouts() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"workouts" | "library">("workouts");
  const [building, setBuilding] = useState(false);
  const groupsQuery = useQuery({
    queryKey: queryKeys.workoutGroups.all,
    queryFn: () => api.get<WorkoutGroup[]>("/api/workouts/groups"),
    staleTime: 60_000,
  });
  const summaryQuery = useQuery({
    queryKey: queryKeys.analytics.weeklySummary,
    queryFn: () => api.get<WeeklySummary>("/api/analytics/weekly-summary"),
    staleTime: 120_000,
  });
  const exercisesQuery = useQuery({
    queryKey: queryKeys.exercises.all,
    queryFn: () => api.get<Exercise[]>("/api/exercises"),
    staleTime: 300_000,
  });

  return (
    <div className="m-controller-page flex flex-col gap-5">
      <header className="m-anim-slide-up">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="m-eyebrow">Training</p>
            <h1 className="mt-1 text-[28px] font-semibold tracking-tight text-[var(--m-text)]">
              Move. Log. Repeat.
            </h1>
            <p className="mt-1.5 text-[13px] text-[var(--m-text-2)]">
              Your workout control room.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setBuilding(true)}
            className="m-press flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[var(--m-primary)] text-[var(--m-primary-fg)]"
            aria-label="Create workout group"
          >
            <Plus width={19} height={19} />
          </button>
        </div>
      </header>

      <section className="m-train-overview m-anim-slide-up">
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.13em] text-black/50">
              <TrendingUp width={13} height={13} />
              Weekly momentum
            </span>
            <p className="mt-1.5 text-[20px] font-semibold tracking-tight text-black">
              Build on your last effort
            </p>
            <p className="mt-1 text-[10px] font-medium text-black/55">
              Small improvements compound. Add a rep or lift a little heavier.
            </p>
          </div>
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-black/10 px-2.5 py-1.5 font-mono text-[10px] font-black text-black/70">
            <Flame width={12} height={12} fill="currentColor" />
            {summaryQuery.data?.exercise.weeksInRow ?? 0}w
          </span>
        </div>
        <div className="mt-4 grid grid-cols-3 divide-x divide-black/10 border-t border-black/10 pt-3">
          {[
            ["Sessions", summaryQuery.data?.exercise.sessions ?? 0],
            ["Sets", summaryQuery.data?.exercise.totalSets ?? 0],
            [
              "Volume",
              `${Math.round((summaryQuery.data?.exercise.volumeKg ?? 0) / 100) / 10}k`,
            ],
          ].map(([label, value]) => (
            <div key={label} className="min-w-0 px-2 text-center first:pl-0 last:pr-0">
              <p className="truncate font-mono text-[17px] font-black tabular-nums text-black">
                {value}
              </p>
              <p className="mt-0.5 truncate text-[8px] font-bold uppercase tracking-[0.09em] text-black/45">
                {label}
              </p>
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-2 rounded-xl bg-[var(--m-surface-2)] p-1">
        <Tab active={tab === "workouts"} onClick={() => setTab("workouts")} icon={Activity}>Workouts</Tab>
        <Tab active={tab === "library"} onClick={() => setTab("library")} icon={BookOpen}>Exercises</Tab>
      </div>

      {(groupsQuery.isError || exercisesQuery.isError) && (
        <MobileErrorState
          title="Using offline training mode"
          message="Your changes will stay safely on this device while the live service is unavailable."
          onRetry={() => {
            void groupsQuery.refetch();
            void exercisesQuery.refetch();
          }}
        />
      )}

      {tab === "workouts" ? (
        <div className="space-y-3">
          {groupsQuery.isLoading && <><div className="m-skeleton h-32 rounded-xl" /><div className="m-skeleton h-32 rounded-xl" /></>}
          {(groupsQuery.data ?? []).map((group) => (
            <WorkoutGroupCard key={group.id} group={group} />
          ))}
          {!groupsQuery.isLoading && (groupsQuery.data ?? []).length === 0 && (
            <button
              type="button"
              onClick={() => setBuilding(true)}
              className="m-inset m-press flex min-h-40 w-full flex-col items-center justify-center gap-2 p-6 text-center"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--m-primary)] text-[var(--m-primary-fg)]"><Dumbbell width={18} height={18} /></span>
              <span className="text-[14px] font-semibold">Build your first workout</span>
              <span className="text-[11px] text-[var(--m-text-3)]">Choose movements, targets, and training days.</span>
            </button>
          )}
        </div>
      ) : (
        <ExerciseLibrary exercises={exercisesQuery.data ?? []} />
      )}

      {building && (
        <WorkoutBuilder
          exercises={exercisesQuery.data ?? []}
          onClose={() => setBuilding(false)}
          onCreated={() => {
            setBuilding(false);
            void queryClient.invalidateQueries({ queryKey: queryKeys.workoutGroups.all });
          }}
        />
      )}
    </div>
  );
}

function Tab({ active, onClick, icon: Icon, children }: { active: boolean; onClick: () => void; icon: typeof Activity; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className={cn("m-press flex min-h-11 items-center justify-center gap-1.5 rounded-lg text-[11px] font-semibold", active ? "bg-[var(--m-primary)] text-[var(--m-primary-fg)] shadow-sm" : "text-[var(--m-text-3)]")}><Icon width={14} height={14} />{children}</button>;
}

function WorkoutGroupCard({ group }: { group: WorkoutGroup }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const detail = useQuery({
    queryKey: queryKeys.workoutGroups.detail(group.id),
    queryFn: () => api.get<WorkoutGroup & { exercises: GroupExercise[] }>(`/api/workouts/groups/${group.id}`),
  });
  const start = useMutation({
    mutationFn: () => api.post<WorkoutSession>(`/api/workouts/sessions/start/${group.id}`, {}),
    onSuccess: (session) => void navigate({ to: "/m/workouts/$sessionId", params: { sessionId: session.id } }),
    onError: () => notify({ title: "Couldn’t start workout", body: "Try again in a moment." }),
  });
  const deleteGroup = useMutation({
    mutationFn: () => api.delete<{ success: boolean }>(`/api/workouts/groups/${group.id}`),
    onSuccess: () => {
      setConfirmDelete(false);
      queryClient.removeQueries({
        queryKey: queryKeys.workoutGroups.detail(group.id),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.workoutGroups.all,
      });
      notify({ title: "Workout deleted", body: `${group.name} was removed from your plans.` });
    },
    onError: () => notify({ title: "Couldn’t delete workout", body: "Try again in a moment." }),
  });
  const exercises = detail.data?.exercises ?? [];
  const sets = exercises.reduce(
    (sum, item) =>
      sum + (item.trackingType === "run" ? 1 : item.defaultSets),
    0,
  );
  const trainingDays = parseTrainingDays(group.targetDays);
  return (
    <article className="m-train-plan-card overflow-hidden">
      <div className="p-3.5 pb-2.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[8px] font-bold uppercase tracking-[0.12em] text-[var(--m-text-3)]">
              Training plan
            </p>
            <h2 className="mt-1 truncate text-[19px] font-semibold tracking-tight text-[var(--m-text)]">
              {group.name}
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <span className="rounded-full border border-[var(--m-border)] bg-white/[0.04] px-2 py-1 text-[8px] font-semibold text-[var(--m-text-2)]">
              {exercises.length} moves · {sets} sets
            </span>
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="m-press flex h-11 w-11 items-center justify-center rounded-full border border-[var(--m-border)] bg-white/[0.035] text-[var(--m-text-3)]"
              aria-label={`Delete ${group.name}`}
            >
              <Trash2 width={15} height={15} />
            </button>
          </div>
        </div>

        <TrainingDatePreview days={trainingDays} />
      </div>

      {exercises.length > 0 && (
        <div className="border-t border-[var(--m-border)] px-2.5 py-2.5">
          <div className="mb-1.5 flex items-center justify-between px-1">
            <p className="text-[9px] font-bold uppercase tracking-[0.11em] text-[var(--m-text-3)]">
              Workout preview
            </p>
            <span className="text-[9px] text-[var(--m-text-3)]">
              Target · previous · best
            </span>
          </div>
          <div className="m-train-plan-list">
            {exercises.map((exercise) => {
              const previous =
                exercise.performance?.previousWorkout?.sets.at(-1);
              return (
                <div key={exercise.id} className="m-train-plan-exercise">
                  <ExerciseImage
                    name={exercise.exerciseName}
                    alt={`${exercise.exerciseName} exercise`}
                    className="h-11 w-12 shrink-0 rounded-[10px] border border-[var(--m-border)]"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-semibold text-[var(--m-text)]">
                      {exercise.exerciseName}
                    </p>
                    <p className="mt-0.5 truncate text-[10px] font-medium text-[var(--m-text-2)]">
                      Target {formatExerciseTarget(exercise)}
                    </p>
                    <p className="mt-0.5 truncate text-[9px] text-[var(--m-text-3)]">
                      Last {previous ? formatPerformance(previous, exercise.trackingType === "run") : "—"}
                    </p>
                  </div>
                  <span className="max-w-[72px] shrink-0 text-right">
                    <span className="block text-[8px] font-bold uppercase tracking-[0.08em] text-[#ff9a78]">
                      Best
                    </span>
                    <span className="mt-0.5 block text-[9px] font-semibold leading-tight text-[var(--m-text-2)]">
                      {exercise.performance?.bestSet
                        ? formatPerformance(
                            exercise.performance.bestSet,
                            exercise.trackingType === "run",
                          )
                        : "Baseline"}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="border-t border-[var(--m-border)] p-2.5">
        <button
          type="button"
          onClick={() => start.mutate()}
          disabled={start.isPending || exercises.length === 0}
          className="m-train-start-button m-press"
        >
          <Play width={14} height={14} fill="currentColor" />
          {start.isPending ? "Preparing workout…" : `Start ${group.name}`}
        </button>
      </div>

      <DialogPrimitive.Root open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm" />
          <DialogPrimitive.Content className="m-delete-workout-dialog fixed left-1/2 top-1/2 z-[71] w-[calc(100vw-32px)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-[22px] border border-[var(--m-border)] p-5 shadow-2xl">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#ff765f]/12 text-[#ff8e79]">
              <Trash2 width={18} height={18} />
            </span>
            <DialogPrimitive.Title className="mt-4 text-[20px] font-semibold tracking-tight text-[var(--m-text)]">
              Delete {group.name}?
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="mt-1.5 text-[12px] leading-relaxed text-[var(--m-text-2)]">
              This removes the training plan and its saved device sessions. This can’t be undone.
            </DialogPrimitive.Description>
            <div className="mt-5 grid grid-cols-2 gap-2.5">
              <DialogPrimitive.Close asChild>
                <button type="button" className="m-press min-h-12 rounded-xl border border-[var(--m-border)] bg-white/[0.04] text-[12px] font-semibold text-[var(--m-text-2)]">
                  Keep plan
                </button>
              </DialogPrimitive.Close>
              <button
                type="button"
                onClick={() => deleteGroup.mutate()}
                disabled={deleteGroup.isPending}
                className="m-press min-h-12 rounded-xl bg-[#ff765f] text-[12px] font-bold text-[#17110f] disabled:opacity-60"
              >
                {deleteGroup.isPending ? "Deleting…" : "Delete workout"}
              </button>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </article>
  );
}

function TrainingDatePreview({ days }: { days: number[] }) {
  const nextDate = upcomingTrainingDates(days, 1)[0];
  const dayLabels = TRAINING_DAYS.filter((item) => days.includes(item.day))
    .map((item) => item.short)
    .join(" · ");
  return (
    <div className="m-train-schedule-line mt-2.5">
      <CalendarDays width={14} height={14} />
      <span className="min-w-0 flex-1 truncate font-semibold text-[var(--m-text-2)]">
        {dayLabels || "Flexible · any day"}
      </span>
      <span className="shrink-0 font-mono text-[9px] font-bold text-[#c6ff77]">
        {nextDate ? `NEXT ${format(nextDate, "d MMM").toUpperCase()}` : "READY"}
      </span>
    </div>
  );
}

function formatExerciseTarget(exercise: GroupExercise) {
  return exercise.trackingType === "run"
    ? `${exercise.defaultDistanceKm ?? "—"} km · ${exercise.defaultDurationMinutes ?? "—"} min`
    : `${exercise.defaultSets} × ${exercise.defaultReps}${exercise.defaultWeight ? ` @ ${exercise.defaultWeight} kg` : ""}`;
}

function ExerciseLibrary({ exercises }: { exercises: Exercise[] }) {
  const [search, setSearch] = useState("");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const performanceQuery = useQuery({
    queryKey: queryKeys.workoutPerformance.byExercises(
      exercises.slice(0, 100).map((exercise) => exercise.id),
    ),
    queryFn: () =>
      api.get<ExercisePerformance[]>(
        `/api/workouts/performance?exerciseIds=${exercises
          .slice(0, 100)
          .map((exercise) => exercise.id)
          .join(",")}`,
      ),
    enabled: exercises.length > 0,
    staleTime: 60_000,
  });
  const quickStart = useMutation({
    mutationFn: async (exercise: Exercise) => {
      const performance = performanceQuery.data?.find(
        (item) => item.exerciseId === exercise.id,
      );
      const previous = performance?.previousWorkout?.sets.at(-1);
      const group = await api.post<WorkoutGroup>("/api/workouts/groups", {
        name: `Quick · ${exercise.name}`,
        targetDays: null,
        exercises: [
          {
            exerciseId: exercise.id,
            position: 0,
            defaultSets: exercise.trackingType === "run" ? 1 : 3,
            defaultReps:
              exercise.trackingType === "run"
                ? 1
                : Number(previous?.reps ?? 10),
            defaultWeight:
              exercise.trackingType === "run"
                ? 0
                : Number(previous?.weight ?? 0),
            defaultDistanceKm:
              exercise.trackingType === "run"
                ? Number(previous?.distanceKm ?? 5)
                : undefined,
            defaultDurationMinutes:
              exercise.trackingType === "run"
                ? Number(previous?.durationMinutes ?? 30)
                : undefined,
          },
        ],
      });
      return api.post<WorkoutSession>(
        `/api/workouts/sessions/start/${group.id}`,
        {},
      );
    },
    onSuccess: (session) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.workoutGroups.all,
      });
      void navigate({
        to: "/m/workouts/$sessionId",
        params: { sessionId: session.id },
      });
    },
    onError: () =>
      notify({
        title: "Couldn’t quick start",
        body: "Try again or add the exercise to a workout plan.",
      }),
  });
  const filtered = exercises.filter((item) => item.name.toLowerCase().includes(search.toLowerCase()));
  return <div className="space-y-3">
    <ExerciseSearchField
      value={search}
      onChange={setSearch}
      placeholder="Search exercises"
    />
    <MobileCreateExercise
      initialName={search}
      triggerLabel={search.trim() ? `Create “${search.trim()}”` : "Create custom exercise"}
    />
    <div className="m-card divide-y divide-[var(--m-border)] overflow-hidden">
      {filtered.length === 0 && (
        <div className="px-4 py-7 text-center">
          <p className="text-[12px] font-semibold text-[var(--m-text-2)]">
            No matching exercise
          </p>
          <p className="mt-1 text-[10px] text-[var(--m-text-3)]">
            Create it above and it will stay in your exercise library.
          </p>
        </div>
      )}
      {filtered.map((exercise) => {
        const performance = performanceQuery.data?.find(
          (item) => item.exerciseId === exercise.id,
        );
        return (
        <div key={exercise.id} className="flex min-h-[76px] items-center gap-3 px-3 py-2.5">
          <ExerciseImage
            name={exercise.name}
            alt={`${exercise.name} demonstration`}
            className="h-14 w-16 shrink-0 rounded-xl border border-[var(--m-border)]"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium">{exercise.name}</p>
            <p className="truncate text-[10px] capitalize text-[var(--m-text-3)]">
              {exercise.category.replace("_", " ")} · {exercise.equipmentType.replace("_", " ")}
            </p>
            {performance?.bestSet && (
              <p className="mt-1 flex items-center gap-1 truncate text-[9px] font-semibold text-[#ff9a78]">
                <Medal width={10} height={10} />
                Best {formatPerformance(performance.bestSet, exercise.trackingType === "run")}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => quickStart.mutate(exercise)}
            disabled={quickStart.isPending}
            className="m-press flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl bg-[var(--m-primary)] px-3 text-[11px] font-bold text-[var(--m-primary-fg)] disabled:opacity-50"
            aria-label={`Quick start ${exercise.name}`}
          >
            {quickStart.isPending &&
            quickStart.variables?.id === exercise.id ? (
              <Clock3 width={13} height={13} />
            ) : (
              <Play width={13} height={13} fill="currentColor" />
            )}
            Start
          </button>
        </div>
      )})}
    </div>
  </div>;
}

function formatPerformance(
  set: {
    weight: number | null;
    reps: number | null;
    distanceKm: number | null;
    durationMinutes: number | null;
  },
  run: boolean,
) {
  return run
    ? `${set.distanceKm ?? "—"} km · ${set.durationMinutes ?? "—"} min`
    : `${set.weight ?? 0} kg × ${set.reps ?? "—"}`;
}

function WorkoutBuilder({ exercises, onClose, onCreated }: { exercises: Exercise[]; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<BuilderExercise[]>([]);
  const filtered = useMemo(() => exercises.filter((item) => item.name.toLowerCase().includes(search.toLowerCase())), [exercises, search]);
  const previewDates = useMemo(
    () => upcomingTrainingDates(selectedDays, 4),
    [selectedDays],
  );
  const create = useMutation({
    mutationFn: () => api.post("/api/workouts/groups", {
      name: name.trim(),
      targetDays:
        TRAINING_DAYS.filter((day) => selectedDays.includes(day.day))
          .map((day) => day.short)
          .join(", ") || null,
      exercises: selected.map((item, position) => ({ exerciseId: item.id, position, defaultSets: item.sets, defaultReps: item.reps, defaultWeight: item.weight, defaultDistanceKm: item.trackingType === "run" ? item.distanceKm : undefined, defaultDurationMinutes: item.trackingType === "run" ? item.durationMinutes : undefined })),
    }),
    onSuccess: () => { notify({ title: "Workout ready", body: `${name.trim()} was added to your training.` }); onCreated(); },
  });
  const add = (exercise: Exercise) => setSelected((current) => current.some((item) => item.id === exercise.id) ? current : [...current, { ...exercise, sets: 3, reps: 10, weight: 0, distanceKm: 5, durationMinutes: 30 }]);
  const update = (exerciseId: string, field: keyof BuilderExercise, value: number) => setSelected((current) => current.map((item) => item.id === exerciseId ? { ...item, [field]: value } : item));
  const toggleDay = (day: number) =>
    setSelectedDays((current) =>
      current.includes(day)
        ? current.filter((value) => value !== day)
        : [...current, day],
    );
  return <div className="m-controller-overlay fixed inset-0 z-[70] overflow-y-auto bg-[var(--m-bg)] px-4 pb-8 pt-[max(16px,env(safe-area-inset-top))]">
    <div className="mx-auto max-w-lg">
      <header className="sticky top-0 z-10 -mx-4 flex items-center justify-between border-b border-[var(--m-border)] bg-[var(--m-bg)]/95 px-4 pb-3 backdrop-blur">
        <button type="button" onClick={onClose} className="m-icon-button m-press" aria-label="Close workout builder"><X width={17} height={17} /></button>
        <p className="text-[14px] font-semibold">New workout</p>
        <button type="button" onClick={() => create.mutate()} disabled={!name.trim() || selected.length === 0 || create.isPending} className="m-press min-h-11 rounded-xl bg-[var(--m-primary)] px-3 text-[12px] font-semibold text-[var(--m-primary-fg)] disabled:opacity-40">{create.isPending ? "Saving…" : "Save"}</button>
      </header>
      <div className="mt-5 space-y-5">
        <section className="m-card p-4">
          <label className="mb-1 block text-[11px] font-semibold">Workout name</label>
          <input autoFocus className="m-field w-full" value={name} onChange={(e) => setName(e.target.value)} placeholder="Push day, Morning run…" />

          <div className="mt-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold">Preferred training days</p>
              <p className="mt-0.5 text-[9px] text-[var(--m-text-3)]">
                Select any days that fit your routine.
              </p>
            </div>
            {selectedDays.length > 0 && (
              <button
                type="button"
                onClick={() => setSelectedDays([])}
                className="m-press min-h-9 px-2 text-[10px] font-semibold text-[var(--m-text-3)]"
              >
                Clear
              </button>
            )}
          </div>

          <div className="mt-3 grid grid-cols-7 gap-1.5" aria-label="Preferred training days">
            {TRAINING_DAYS.map((day) => {
              const active = selectedDays.includes(day.day);
              return (
                <button
                  type="button"
                  key={day.short}
                  onClick={() => toggleDay(day.day)}
                  aria-pressed={active}
                  aria-label={day.label}
                  className={cn(
                    "m-training-day-button m-press",
                    active && "is-selected",
                  )}
                >
                  {day.short.slice(0, 1)}
                </button>
              );
            })}
          </div>

          <div className="mt-4 border-t border-[var(--m-border)] pt-3">
            <div className="mb-2 flex items-center gap-2">
              <CalendarDays width={14} height={14} className="text-[var(--m-text-3)]" />
              <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--m-text-3)]">
                Upcoming preview
              </p>
            </div>
            {previewDates.length > 0 ? (
              <div className="grid grid-cols-4 gap-2">
                {previewDates.map((date, index) => (
                  <div
                    key={date.toISOString()}
                    className={cn(
                      "m-training-date-card",
                      index === 0 && "is-next",
                    )}
                  >
                    <span>{format(date, "EEE")}</span>
                    <strong>{format(date, "d")}</strong>
                    <small>{format(date, "MMM")}</small>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-[var(--m-border)] bg-white/[0.025] px-3 py-3 text-[10px] text-[var(--m-text-3)]">
                No fixed dates — this workout will be available any day.
              </div>
            )}
          </div>
        </section>
        {selected.length > 0 && (
          <section>
            <h2 className="m-eyebrow mb-2">Your workout · {selected.length}</h2>
            <div className="space-y-2">
              {selected.map((item) => (
                <div key={item.id} className="m-card p-3">
                  <div className="mb-3 flex items-center gap-3">
                    <ExerciseImage
                      name={item.name}
                      alt={`${item.name} demonstration`}
                      className="h-14 w-16 shrink-0 rounded-xl border border-[var(--m-border)]"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold">{item.name}</p>
                      <p className="mt-0.5 truncate text-[10px] capitalize text-[var(--m-text-3)]">
                        {item.equipmentType.replace("_", " ")}
                      </p>
                    </div>
                    <button type="button" onClick={() => setSelected((current) => current.filter((entry) => entry.id !== item.id))} className="m-icon-button m-press" aria-label={`Remove ${item.name}`}><X width={14} height={14} /></button>
                  </div>
                  {item.trackingType === "run" ? <div className="grid grid-cols-2 gap-2"><NumberField label="Kilometres" value={item.distanceKm} step={0.1} onChange={(value) => update(item.id, "distanceKm", value)} /><NumberField label="Minutes" value={item.durationMinutes} onChange={(value) => update(item.id, "durationMinutes", value)} /></div> : <div className="grid grid-cols-3 gap-2"><NumberField label="Sets" value={item.sets} onChange={(value) => update(item.id, "sets", value)} /><NumberField label="Reps" value={item.reps} onChange={(value) => update(item.id, "reps", value)} /><NumberField label="Kg" value={item.weight} step={2.5} onChange={(value) => update(item.id, "weight", value)} /></div>}
                </div>
              ))}
            </div>
          </section>
        )}
        <section>
          <h2 className="m-eyebrow mb-2">Add exercises</h2>
          <ExerciseSearchField
            value={search}
            onChange={setSearch}
            placeholder="Search movements"
          />
          <div className="my-2">
            <MobileCreateExercise
              initialName={search}
              triggerLabel={search.trim() ? `Create “${search.trim()}”` : "Create custom exercise"}
              onCreated={add}
            />
          </div>
          <div className="m-card max-h-[42dvh] divide-y divide-[var(--m-border)] overflow-y-auto">
            {filtered.length === 0 && (
              <p className="px-4 py-6 text-center text-[10px] text-[var(--m-text-3)]">
                Nothing found. Create this movement above to add it now.
              </p>
            )}
            {filtered.map((exercise) => {
              const added = selected.some((item) => item.id === exercise.id);
              return (
                <button type="button" key={exercise.id} onClick={() => add(exercise)} disabled={added} className="m-press flex min-h-16 w-full items-center gap-3 px-3 py-2 text-left disabled:opacity-50">
                  <ExerciseImage
                    name={exercise.name}
                    alt={`${exercise.name} demonstration`}
                    className="h-12 w-14 shrink-0 rounded-xl border border-[var(--m-border)]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{exercise.name}</span>
                    <span className="block truncate text-[10px] capitalize text-[var(--m-text-3)]">{exercise.equipmentType.replace("_", " ")}</span>
                  </span>
                  <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", added ? "bg-[var(--m-primary)] text-[var(--m-primary-fg)]" : "bg-[var(--m-surface-2)]")}>{added ? <Check width={14} height={14} /> : <Plus width={14} height={14} />}</span>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  </div>;
}

function ExerciseSearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="m-field-shell m-exercise-search w-full">
      <Search
        width={16}
        height={16}
        className="shrink-0"
        aria-hidden="true"
      />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
    </label>
  );
}

const EQUIPMENT_OPTIONS = [
  ["free_weight", "Free weight"],
  ["machine", "Machine"],
  ["bodyweight", "Bodyweight"],
  ["cardio", "Cardio machine"],
  ["outdoor", "Outdoor"],
  ["other", "Other"],
] as const;

function MobileCreateExercise({
  initialName,
  triggerLabel,
  onCreated,
}: {
  initialName: string;
  triggerLabel: string;
  onCreated?: (exercise: Exercise) => void;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [trackingType, setTrackingType] = useState<"strength" | "run">("strength");
  const [category, setCategory] = useState("functional");
  const [equipmentType, setEquipmentType] = useState("other");
  const createExercise = useMutation({
    mutationFn: () =>
      api.post<Exercise>("/api/exercises", {
        name: name.trim(),
        trackingType,
        category,
        equipmentType,
      }),
    onSuccess: (exercise) => {
      queryClient.setQueryData<Exercise[]>(
        queryKeys.exercises.all,
        (current = []) =>
          [...current.filter((item) => item.id !== exercise.id), exercise].sort(
            (a, b) => a.name.localeCompare(b.name),
          ),
      );
      setOpen(false);
      onCreated?.(exercise);
      notify({
        title: "Exercise added",
        body: `${exercise.name} is ready to use.`,
      });
    },
    onError: () =>
      notify({
        title: "Couldn’t add exercise",
        body: "Check the name and try again.",
      }),
  });

  const openCreator = () => {
    setName(initialName.trim());
    setTrackingType("strength");
    setCategory("functional");
    setEquipmentType("other");
    setOpen(true);
  };

  const switchTracking = (value: "strength" | "run") => {
    setTrackingType(value);
    if (value === "run") {
      setCategory("cardio");
      setEquipmentType("outdoor");
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={openCreator}
        className="m-create-exercise-trigger m-press"
      >
        <Plus width={15} height={15} />
        <span className="truncate">{triggerLabel}</span>
      </button>
      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-[80] bg-black/65 backdrop-blur-sm" />
          <DialogPrimitive.Content className="m-controller-surface m-create-exercise-dialog fixed bottom-0 left-1/2 z-[81] w-full max-w-lg -translate-x-1/2 rounded-t-[26px] border border-b-0 border-[var(--m-border)] p-4 pb-[max(20px,env(safe-area-inset-bottom))] shadow-2xl">
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20" />
            <div className="flex items-start justify-between gap-3">
              <div>
                <DialogPrimitive.Title className="text-[20px] font-semibold tracking-tight text-[var(--m-text)]">
                  Create exercise
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="mt-1 text-[11px] text-[var(--m-text-2)]">
                  Add a movement that is missing from your library.
                </DialogPrimitive.Description>
              </div>
              <DialogPrimitive.Close className="m-icon-button m-press" aria-label="Close exercise creator">
                <X width={16} height={16} />
              </DialogPrimitive.Close>
            </div>

            <form
              className="mt-4 space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (name.trim()) createExercise.mutate();
              }}
            >
              <label className="block">
                <span className="mb-1.5 block text-[10px] font-semibold text-[var(--m-text-2)]">
                  Exercise name
                </span>
                <input
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="m-field w-full"
                  placeholder="e.g. Cable reverse lunge"
                  maxLength={120}
                />
              </label>

              <fieldset>
                <legend className="mb-1.5 text-[10px] font-semibold text-[var(--m-text-2)]">
                  Track by
                </legend>
                <div className="grid grid-cols-2 rounded-xl bg-black/15 p-1">
                  {(["strength", "run"] as const).map((value) => (
                    <button
                      type="button"
                      key={value}
                      onClick={() => switchTracking(value)}
                      className={cn(
                        "m-press min-h-11 rounded-[10px] text-[11px] font-semibold capitalize",
                        trackingType === value
                          ? "bg-[var(--m-primary)] text-[var(--m-primary-fg)]"
                          : "text-[var(--m-text-3)]",
                      )}
                      aria-pressed={trackingType === value}
                    >
                      {value === "strength" ? "Sets & weight" : "Distance & time"}
                    </button>
                  ))}
                </div>
              </fieldset>

              <div className="grid grid-cols-2 gap-2.5">
                <label className="min-w-0">
                  <span className="mb-1.5 block text-[10px] font-semibold text-[var(--m-text-2)]">
                    Category
                  </span>
                  <span className="relative block">
                    <select
                      value={category}
                      onChange={(event) => setCategory(event.target.value)}
                      className="m-field w-full appearance-none pr-9 text-[13px]"
                    >
                      {Object.entries(EXERCISE_CATEGORIES)
                        .sort(([, a], [, b]) => a.order - b.order)
                        .map(([value, meta]) => (
                          <option key={value} value={value}>{meta.label}</option>
                        ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#526067]" width={15} height={15} />
                  </span>
                </label>
                <label className="min-w-0">
                  <span className="mb-1.5 block text-[10px] font-semibold text-[var(--m-text-2)]">
                    Equipment
                  </span>
                  <span className="relative block">
                    <select
                      value={equipmentType}
                      onChange={(event) => setEquipmentType(event.target.value)}
                      className="m-field w-full appearance-none pr-9 text-[13px]"
                    >
                      {EQUIPMENT_OPTIONS.map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#526067]" width={15} height={15} />
                  </span>
                </label>
              </div>

              <button
                type="submit"
                disabled={!name.trim() || createExercise.isPending}
                className="m-primary-button m-press min-h-12 w-full rounded-xl bg-[var(--m-primary)] text-[12px] font-bold text-[var(--m-primary-fg)] disabled:opacity-45"
              >
                {createExercise.isPending ? "Adding exercise…" : "Add to exercise library"}
              </button>
            </form>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}

function NumberField({ label, value, step = 1, onChange }: { label: string; value: number; step?: number; onChange: (value: number) => void }) {
  return <label><span className="mb-1 block text-[9px] font-semibold uppercase text-[var(--m-text-3)]">{label}</span><input type="number" min={step} step={step} value={value} onChange={(event) => onChange(Math.max(step, Number(event.target.value)))} className="m-field w-full px-2 text-center" /></label>;
}
