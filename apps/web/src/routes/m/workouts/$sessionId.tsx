import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Edit3,
  Medal,
  Plus,
  Sparkles,
  Timer,
} from "lucide-react";
import { api } from "@/lib/api";
import {
  queryKeys,
  type ExercisePerformance,
  type SessionExerciseLog,
  type SessionSet,
  type WorkoutSession,
} from "@/lib/query-keys";
import { MobileErrorState } from "@/components/mobile/error-state";
import { notify } from "@/components/mobile/notification-banner";
import { ExerciseImage } from "@/components/workouts/exercise-image";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/m/workouts/$sessionId")({
  component: MobileWorkoutSession,
});

function MobileWorkoutSession() {
  const { sessionId } = Route.useParams();
  const navigate = useNavigate();
  const [elapsed, setElapsed] = useState(0);
  const [rest, setRest] = useState<number | null>(null);
  const [activeLogId, setActiveLogId] = useState<string | null>(null);

  const session = useQuery({
    queryKey: queryKeys.workoutSessions.detail(sessionId),
    queryFn: () =>
      api.get<WorkoutSession & { exerciseLogs: SessionExerciseLog[] }>(
        `/api/workouts/sessions/${sessionId}`,
      ),
    refetchInterval: 15_000,
  });

  const logs = session.data?.exerciseLogs ?? [];
  const exerciseIds = useMemo(
    () => logs.map((log) => log.exerciseId),
    [logs],
  );
  const performance = useQuery({
    queryKey: queryKeys.workoutPerformance.byExercises(exerciseIds),
    queryFn: () =>
      api.get<ExercisePerformance[]>(
        `/api/workouts/performance?exerciseIds=${exerciseIds.join(",")}`,
      ),
    enabled: exerciseIds.length > 0,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!session.data?.startedAt) return;
    const start = new Date(session.data.startedAt).getTime();
    const timer = window.setInterval(
      () => setElapsed(Math.max(0, Math.floor((Date.now() - start) / 1000))),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [session.data?.startedAt]);

  useEffect(() => {
    if (rest === null) return;
    if (rest <= 0) {
      setRest(null);
      return;
    }
    const timer = window.setTimeout(
      () => setRest((value) => (value === null ? null : value - 1)),
      1000,
    );
    return () => window.clearTimeout(timer);
  }, [rest]);

  useEffect(() => {
    if (logs.length === 0) return;
    if (activeLogId && logs.some((log) => log.id === activeLogId)) return;
    const firstIncomplete =
      logs.find((log) => log.sets.some((set) => !set.completedAt)) ?? logs[0];
    setActiveLogId(firstIncomplete.id);
  }, [activeLogId, logs]);

  const completedSets = logs
    .flatMap((log) => log.sets)
    .filter((set) => set.completedAt);
  const totalSets = logs.flatMap((log) => log.sets).length;
  const completedExercises = logs.filter(
    (log) =>
      log.sets.length > 0 && log.sets.every((set) => Boolean(set.completedAt)),
  ).length;
  const totalVolume = completedSets.reduce(
    (sum, set) => sum + Number(set.weight ?? 0) * Number(set.reps ?? 0),
    0,
  );
  const progressPercent =
    totalSets > 0 ? Math.round((completedSets.length / totalSets) * 100) : 0;
  const activeLog =
    logs.find((log) => log.id === activeLogId) ?? logs[0] ?? null;
  const activeIndex = activeLog
    ? logs.findIndex((log) => log.id === activeLog.id)
    : -1;
  const nextLog =
    activeIndex >= 0
      ? [...logs.slice(activeIndex + 1), ...logs.slice(0, activeIndex)].find(
          (log) => log.sets.some((set) => !set.completedAt),
        )
      : undefined;

  const finish = useMutation({
    mutationFn: () =>
      api.post<WorkoutSession>(
        `/api/workouts/sessions/${sessionId}/finish`,
        {},
      ),
    onSuccess: () => {
      notify({
        title: "Workout complete",
        body: `${completedSets.length} sets · ${Math.round(totalVolume).toLocaleString()} kg moved. Strong work.`,
      });
      void navigate({ to: "/m/workouts" });
    },
    onError: () =>
      notify({
        title: "Couldn’t finish workout",
        body: "Your completed sets are safe. Try again.",
      }),
  });

  const formatTime = (seconds: number) =>
    `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <div className="m-controller-page m-train-session flex h-full min-h-0 flex-col gap-2">
      <header className="m-live-workout-header m-anim-slide-up">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => void navigate({ to: "/m/workouts" })}
            className="m-icon-button m-press"
            aria-label="Back to workouts"
          >
            <ChevronLeft width={18} height={18} />
          </button>
          <div className="min-w-0 flex-1 text-center">
            <span className="block text-[8px] font-bold uppercase tracking-[0.14em] text-[var(--m-primary)]">
              Live workout
            </span>
            <span className="mt-0.5 flex items-center justify-center gap-1.5 font-mono text-[13px] font-bold tabular-nums">
              <Clock3 width={13} height={13} />
              {formatTime(elapsed)}
            </span>
          </div>
          <button
            type="button"
            onClick={() => finish.mutate()}
            disabled={finish.isPending || completedSets.length === 0}
            className="m-press min-h-11 rounded-xl border border-[var(--m-border-strong)] px-3 text-[12px] font-semibold text-[var(--m-text)] disabled:opacity-40"
          >
            {finish.isPending ? "Saving…" : "Finish"}
          </button>
        </div>

        <div className="mt-2.5">
          <div className="flex items-center gap-2.5">
          <div
            className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/[0.08]"
            aria-label={`${progressPercent}% of workout complete`}
          >
            <div
              className="h-full rounded-full bg-[var(--m-primary)] transition-[width] duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
            <span className="font-mono text-[12px] font-black tabular-nums text-[var(--m-primary)]">
              {progressPercent}%
            </span>
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[9px] text-[var(--m-text-3)]">
            <span>{completedExercises}/{logs.length} exercises</span>
            <span>{completedSets.length}/{totalSets} sets</span>
            <span>{logs.length - completedExercises} left</span>
          </div>
        </div>
      </header>

      {session.isError && (
        <MobileErrorState
          title="Workout unavailable"
          onRetry={() => void session.refetch()}
        />
      )}

      {session.isLoading && (
        <>
          <div className="m-skeleton h-20 rounded-2xl" />
          <div className="m-skeleton h-[520px] rounded-3xl" />
        </>
      )}

      {logs.length > 0 && (
        <section className="m-live-exercise-rail" aria-label="Workout exercises">
          <div className="m-train-exercise-rail m-no-scrollbar">
            {logs.map((log, index) => {
              const done =
                log.sets.length > 0 &&
                log.sets.every((set) => Boolean(set.completedAt));
              const active = log.id === activeLog?.id;
              return (
                <button
                  type="button"
                  key={log.id}
                  onClick={() => setActiveLogId(log.id)}
                  className={cn(
                    "m-train-exercise-pill m-press",
                    active && "is-active",
                    done && "is-complete",
                  )}
                  aria-current={active ? "step" : undefined}
                  aria-label={`${log.exerciseName}, ${done ? "complete" : `${log.sets.filter((set) => set.completedAt).length} of ${log.sets.length} sets`}`}
                >
                  <span className="relative">
                    <ExerciseImage
                      name={log.exerciseName}
                      alt=""
                      className="h-9 w-9 rounded-[10px] border border-white/10"
                    />
                    {done && (
                      <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--m-primary)] text-[var(--m-primary-fg)]">
                        <Check width={10} height={10} strokeWidth={3} />
                      </span>
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[8px] font-bold uppercase tracking-[0.12em] text-[var(--m-text-3)]">
                      Exercise {index + 1}
                    </span>
                    <span className="mt-0.5 block max-w-24 truncate text-[11px] font-semibold text-[var(--m-text)]">
                      {log.exerciseName}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {activeLog && (
        <ExerciseFocus
          key={activeLog.id}
          log={activeLog}
          sessionId={sessionId}
          performance={performance.data?.find(
            (item) => item.exerciseId === activeLog.exerciseId,
          )}
          onStrengthSet={() => setRest(60)}
          nextExerciseName={nextLog?.exerciseName}
          onNextExercise={() => {
            if (nextLog) setActiveLogId(nextLog.id);
          }}
        />
      )}

      {rest !== null && (
        <div className="m-train-rest fixed inset-x-4 bottom-[calc(var(--m-nav-height)+env(safe-area-inset-bottom)+12px)] z-50 mx-auto max-w-md">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-[12px] font-bold">
              <Timer width={16} height={16} />
              Recover
            </span>
            <span className="font-mono text-[22px] font-black tabular-nums">
              {rest}s
            </span>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setRest((value) => (value ?? 0) + 30)}
                className="m-press min-h-11 rounded-xl bg-black/10 px-3 text-[11px] font-bold"
              >
                +30
              </button>
              <button
                type="button"
                onClick={() => setRest(null)}
                className="m-press min-h-11 rounded-xl bg-black/10 px-3 text-[11px] font-bold"
              >
                Skip
              </button>
            </div>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/15">
            <div
              className="h-full rounded-full bg-black/75 transition-[width] duration-1000"
              style={{ width: `${Math.min(100, (rest / 60) * 100)}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ExerciseFocus({
  log,
  sessionId,
  performance,
  onStrengthSet,
  nextExerciseName,
  onNextExercise,
}: {
  log: SessionExerciseLog;
  sessionId: string;
  performance?: ExercisePerformance;
  onStrengthSet: () => void;
  nextExerciseName?: string;
  onNextExercise: () => void;
}) {
  const queryClient = useQueryClient();
  const run = log.trackingType === "run";
  const pending = log.sets.find((set) => !set.completedAt);
  const completed = log.sets.filter((set) => set.completedAt);
  const previousSets = performance?.previousWorkout?.sets ?? [];
  const previousLatest = previousSets.at(-1);
  const initial = pending ?? completed.at(-1) ?? previousLatest;
  const [editingSetId, setEditingSetId] = useState<string | null>(null);
  const [weight, setWeight] = useState(initial?.weight ?? 0);
  const [reps, setReps] = useState(initial?.reps ?? 10);
  const [distance, setDistance] = useState(initial?.distanceKm ?? 5);
  const [minutes, setMinutes] = useState(initial?.durationMinutes ?? 30);
  const editingSet = log.sets.find((set) => set.id === editingSetId);

  useEffect(() => {
    const source = editingSet ?? pending ?? completed.at(-1) ?? previousLatest;
    setWeight(source?.weight ?? 0);
    setReps(source?.reps ?? 10);
    setDistance(source?.distanceKm ?? 5);
    setMinutes(source?.durationMinutes ?? 30);
  }, [
    completed.length,
    editingSet,
    pending,
    previousLatest,
  ]);

  const hasPersonalBest = run
    ? performance?.maxDistanceKm !== null &&
      performance?.maxDistanceKm !== undefined
    : Boolean(performance?.bestSet);
  const isPersonalRecord =
    hasPersonalBest &&
    (run
      ? distance > Number(performance?.maxDistanceKm ?? 0)
      : weight > Number(performance?.maxWeight ?? 0) ||
        (weight === Number(performance?.maxWeight ?? 0) &&
          reps > Number(performance?.maxReps ?? 0)));

  const saveSet = useMutation({
    mutationFn: () => {
      const payload = run
        ? { distanceKm: distance, durationMinutes: minutes }
        : { weight, reps };
      return editingSetId
        ? api.patch(
            `/api/workouts/sessions/${sessionId}/logs/${log.id}/sets/${editingSetId}`,
            payload,
          )
        : api.post(
            `/api/workouts/sessions/${sessionId}/logs/${log.id}/sets`,
            payload,
          );
    },
    onSuccess: () => {
      if (isPersonalRecord && !editingSetId) {
        notify({
          title: "New personal record",
          body: run
            ? `${distance} km is your new distance best.`
            : `${weight} kg × ${reps} reps. You raised the bar.`,
        });
      } else if (!editingSetId) {
        notify({
          title: run ? "Run logged" : "Set complete",
          body: completed.length + 1 >= log.sets.length
            ? `${log.exerciseName} complete.`
            : "Stay sharp. The next effort is yours.",
        });
      }
      if (!run && !editingSetId) onStrengthSet();
      setEditingSetId(null);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.workoutSessions.detail(sessionId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.workoutPerformance.all,
      });
    },
    onError: () =>
      notify({
        title: "Set not saved",
        body: "Your values are still here. Try once more.",
      }),
  });

  const previousReference = pending
    ? previousSets[pending.setNumber - 1] ?? previousLatest
    : previousLatest;
  const motivation = run
    ? previousReference
      ? `Last time: ${formatSet(previousReference, true)}. Add 0.1 km or hold a steadier pace.`
      : "Set your baseline today. Every future run starts from this effort."
    : previousReference
      ? `Progress target: ${Number(previousReference.weight ?? 0) + 2.5} kg or ${Number(previousReference.reps ?? 0) + 1} reps.`
      : "Own the first set. This becomes the baseline you beat next time.";
  const nextTarget = previousReference
    ? run
      ? `${Math.round((Number(previousReference.distanceKm ?? 0) + 0.1) * 10) / 10} km`
      : Number(previousReference.weight ?? 0) > 0
        ? `${Number(previousReference.weight ?? 0) + 2.5} kg`
        : `${Number(previousReference.reps ?? 0) + 1} reps`
    : "Set baseline";

  return (
    <article className="m-train-active-card m-anim-slide-up">
      <div className="m-train-active-heading">
        <ExerciseImage
          name={log.exerciseName}
          alt={`${log.exerciseName} demonstration`}
          className="m-live-exercise-image shrink-0 rounded-xl border border-white/10"
        />
        <div className="min-w-0 flex-1">
          <p className="text-[8px] font-bold uppercase tracking-[0.13em] text-[var(--m-primary)]">
            Active exercise
          </p>
          <h2 className="mt-0.5 truncate text-[17px] font-semibold tracking-tight text-[var(--m-text)]">
            {log.exerciseName}
          </h2>
          <p className="mt-1 truncate text-[9px] capitalize text-[var(--m-text-3)]">
            {log.exerciseCategory.replaceAll("_", " ")} · {log.equipmentType.replaceAll("_", " ")}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-white/[0.06] px-2.5 py-1.5 font-mono text-[9px] font-bold text-[var(--m-text-2)]">
          {completed.length}/{log.sets.length}
        </span>
      </div>

      <div className="m-train-reference-grid">
        <div>
          <span>Previous</span>
          <strong>
            {previousLatest ? formatSet(previousLatest, run) : "First session"}
          </strong>
        </div>
        <div>
          <span>Personal best</span>
          <strong>{formatPersonalBest(performance, run)}</strong>
        </div>
        <div className="is-target">
          <span>Next target</span>
          <strong>{nextTarget}</strong>
        </div>
      </div>

      <div className="m-train-active-body">
        <p className="m-live-motivation flex items-center gap-2 truncate text-[9px] font-medium text-[#dfffaf]">
          <Sparkles width={13} height={13} className="shrink-0" />
          {motivation}
        </p>

        <div className="m-live-target-heading mt-2.5 flex items-center justify-between gap-3 border-t border-[var(--m-border)] pt-2.5">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.13em] text-[var(--m-text-3)]">
              {editingSet
                ? `Editing set ${editingSet.setNumber}`
                : pending
                  ? `Set ${pending.setNumber} of ${log.sets.length}`
                  : "Bonus effort"}
            </p>
            <p className="mt-0.5 text-[14px] font-semibold text-[var(--m-text)]">
              {editingSet ? "Adjust your result" : "Set your target"}
            </p>
          </div>
          {isPersonalRecord && (
            <span className="m-train-pr-badge">
              <Medal width={13} height={13} />
              PR attempt
            </span>
          )}
        </div>

        <div className="mt-2.5 grid grid-cols-2 gap-2">
          {run ? (
            <CompactMetricInput
              label="Distance"
              unit="km"
              value={distance}
              step={0.1}
              min={0.1}
              onChange={setDistance}
            />
          ) : (
            <DragMetric
              label="Weight"
              unit="kg"
              value={weight}
              min={0}
              max={Math.max(200, Math.ceil((weight + 20) / 25) * 25)}
              step={2.5}
              onChange={setWeight}
            />
          )}
          {run ? (
            <CompactMetricInput
              label="Duration"
              unit="min"
              value={minutes}
              step={1}
              min={1}
              onChange={setMinutes}
            />
          ) : (
            <DragMetric
              label="Repetitions"
              unit="reps"
              value={reps}
              min={1}
              max={Math.max(30, Math.ceil((reps + 5) / 5) * 5)}
              step={1}
              onChange={setReps}
            />
          )}
        </div>

        <button
          type="button"
          onClick={() => saveSet.mutate()}
          disabled={saveSet.isPending}
          className="m-train-log-button m-press mt-2.5"
        >
          {saveSet.isPending ? (
            "Saving effort…"
          ) : editingSet ? (
            <>
              <Check width={17} height={17} strokeWidth={2.5} />
              Save set
            </>
          ) : pending ? (
            <>
              <Check width={17} height={17} strokeWidth={2.5} />
              Complete set {pending.setNumber}
            </>
          ) : (
            <>
              <Plus width={17} height={17} strokeWidth={2.5} />
              Add bonus set
            </>
          )}
        </button>

        {editingSet && (
          <button
            type="button"
            onClick={() => setEditingSetId(null)}
            className="m-press mt-2 min-h-11 w-full text-[11px] font-semibold text-[var(--m-text-3)]"
          >
            Cancel editing
          </button>
        )}

        <details className="m-train-history mt-2.5">
          <summary className="m-press flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--m-text-2)]">
            <span>Set history · {completed.length}/{log.sets.length}</span>
            <span className="flex items-center gap-1 text-[9px] normal-case tracking-normal text-[var(--m-text-3)]">
              Previous / today
              <ChevronDown width={14} height={14} />
            </span>
          </summary>
          <div className="m-train-set-list">
            {log.sets.map((set) => {
              const previous = previousSets[set.setNumber - 1];
              return (
                <div
                  key={set.id}
                  className={cn(
                    "m-train-set-row",
                    set.completedAt && "is-complete",
                    editingSetId === set.id && "is-editing",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-black",
                      set.completedAt
                        ? "bg-[var(--m-primary)] text-[var(--m-primary-fg)]"
                        : "bg-white/[0.06] text-[var(--m-text-3)]",
                    )}
                  >
                    {set.completedAt ? (
                      <Check width={12} height={12} strokeWidth={3} />
                    ) : (
                      set.setNumber
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[8px] font-bold uppercase tracking-[0.1em] text-[var(--m-text-3)]">
                      Previous
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] font-medium text-[var(--m-text-2)]">
                      {previous ? formatSet(previous, run) : "—"}
                    </span>
                  </span>
                  <span className="min-w-0 flex-1 text-right">
                    <span className="block text-[8px] font-bold uppercase tracking-[0.1em] text-[var(--m-text-3)]">
                      Today
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] font-semibold text-[var(--m-text)]">
                      {formatSet(set, run)}
                    </span>
                  </span>
                  {set.completedAt ? (
                    <button
                      type="button"
                      onClick={() => setEditingSetId(set.id)}
                      className="m-press flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[var(--m-text-3)]"
                      aria-label={`Edit set ${set.setNumber}`}
                    >
                      <Edit3 width={14} height={14} />
                    </button>
                  ) : (
                    <span className="w-10 shrink-0" />
                  )}
                </div>
              );
            })}
          </div>
        </details>

        {!pending && nextExerciseName && (
          <button
            type="button"
            onClick={onNextExercise}
            className="m-press mt-2.5 flex min-h-11 w-full items-center justify-between rounded-xl border border-[var(--m-border)] bg-white/[0.04] px-3 text-left"
          >
            <span>
              <span className="block text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--m-text-3)]">
                Up next
              </span>
              <span className="mt-0.5 block text-[12px] font-semibold text-[var(--m-text)]">
                {nextExerciseName}
              </span>
            </span>
            <ChevronRight width={17} height={17} />
          </button>
        )}
      </div>
    </article>
  );
}

function DragMetric({
  label,
  unit,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  const [rangeMax] = useState(max);
  const precision = step < 1 ? 1 : Number.isInteger(step) ? 0 : 1;
  const update = (next: number) =>
    onChange(
      Math.min(rangeMax, Math.max(min, Number(next.toFixed(precision)))),
    );
  const progress = ((value - min) / Math.max(1, rangeMax - min)) * 100;

  return (
    <label className="m-train-drag-metric">
      <span className="flex items-center justify-between gap-2">
        <span className="text-[8px] font-bold uppercase tracking-[0.12em] text-[var(--m-text-3)]">
          {label}
        </span>
        <span className="flex items-baseline gap-1">
          <input
            type="number"
            inputMode="decimal"
            min={min}
            max={rangeMax}
            step={step}
            value={value}
            onChange={(event) => update(Number(event.target.value))}
            className="w-14 bg-transparent text-right font-mono text-[18px] font-black leading-none tabular-nums text-[var(--m-text)] outline-none"
            aria-label={`${label} in ${unit}`}
          />
          <span className="text-[8px] font-bold uppercase text-[var(--m-text-3)]">
            {unit}
          </span>
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={rangeMax}
        step={step}
        value={value}
        onChange={(event) => update(Number(event.target.value))}
        className="m-train-drag-slider mt-2 w-full"
        style={{
          background: `linear-gradient(to right, #c6ff77 0%, #c6ff77 ${progress}%, rgba(255,255,255,0.12) ${progress}%, rgba(255,255,255,0.12) 100%)`,
        }}
        aria-label={`Drag to set ${label.toLowerCase()}`}
        aria-valuetext={`${value} ${unit}`}
      />
      <span className="mt-1 flex justify-between font-mono text-[7px] text-[var(--m-text-3)]">
        <span>{min}</span>
        <span>Drag to adjust</span>
        <span>{rangeMax}</span>
      </span>
    </label>
  );
}

function CompactMetricInput({
  label,
  unit,
  value,
  step,
  min,
  onChange,
}: {
  label: string;
  unit: string;
  value: number;
  step: number;
  min: number;
  onChange: (value: number) => void;
}) {
  const precision = step < 1 ? 1 : Number.isInteger(step) ? 0 : 1;
  const update = (next: number) =>
    onChange(Math.max(min, Number(next.toFixed(precision))));
  return (
    <div className="m-train-metric">
      <span className="text-[8px] font-bold uppercase tracking-[0.12em] text-[var(--m-text-3)]">
        {label}
      </span>
      <label className="mt-1.5 flex min-h-9 items-center justify-center gap-1 rounded-lg bg-black/10 px-2">
        <input
          type="number"
          inputMode="decimal"
          min={min}
          step={step}
          value={value}
          onChange={(event) => update(Number(event.target.value))}
          className="min-w-0 w-full bg-transparent text-center font-mono text-[19px] font-black leading-none tabular-nums text-[var(--m-text)] focus:outline-none"
          aria-label={`${label} in ${unit}`}
        />
        <span className="text-[8px] font-bold uppercase text-[var(--m-text-3)]">
          {unit}
        </span>
      </label>
    </div>
  );
}

function formatSet(
  set:
    | SessionSet
    | {
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

function formatPersonalBest(
  performance: ExercisePerformance | undefined,
  run: boolean,
) {
  if (!performance) return "Build your baseline";
  if (run) {
    return performance.maxDistanceKm
      ? `${performance.maxDistanceKm} km best`
      : "Build your baseline";
  }
  return performance.bestSet
    ? `${performance.bestSet.weight ?? 0} kg × ${performance.bestSet.reps ?? 0}`
    : "Build your baseline";
}
