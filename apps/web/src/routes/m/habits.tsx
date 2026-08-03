import { createFileRoute } from "@tanstack/react-router";
import { useQueries, useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { format } from "date-fns";
import { Plus, X } from "lucide-react";
import { api } from "@/lib/api";
import { queryKeys, type Habit, type HabitCompletion } from "@/lib/query-keys";
import { SwipeCard } from "@/components/mobile/swipe-card";
import { StreakFlame } from "@/components/mobile/streak-flame";
import { TogglePill } from "@/components/mobile/toggle-pill";
import { notify } from "@/components/mobile/notification-banner";
import { MobileErrorState } from "@/components/mobile/error-state";

export const Route = createFileRoute("/m/habits")({
  component: MobileHabits,
});

function MobileHabits() {
  const queryClient = useQueryClient();
  const todayKey = format(new Date(), "yyyy-MM-dd");

  const {
    data: habits,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: queryKeys.habits.all,
    queryFn: () => api.get<Habit[]>("/api/habits"),
    staleTime: 120_000,
  });

  const completionQueries = useQueries({
    queries: (habits ?? []).map((habit) => ({
      queryKey: queryKeys.habits.completions(habit.id, todayKey, todayKey),
      queryFn: () =>
        api.get<HabitCompletion[]>(`/api/habits/${habit.id}/completions?from=${todayKey}T00:00:00.000Z&to=${todayKey}T23:59:59.999Z`),
      staleTime: 30_000,
    })),
  });

  const completeMutation = useMutation({
    mutationFn: (habitId: string) => api.post(`/api/habits/${habitId}/complete`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.habits.all });
      void queryClient.invalidateQueries({ queryKey: ["habits"] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.analytics.streaks });
    },
    onError: () =>
      notify({
        title: "Couldn’t update habit",
        body: "Check your connection and try again.",
      }),
  });

  const doneCount = completionQueries.filter((q) => (q.data ?? []).length > 0).length;
  const total = habits?.length ?? 0;

  const handleComplete = (habit: Habit, wasDone: boolean) => {
    completeMutation.mutate(habit.id);
    if (!wasDone) notify({ title: "Habit done", body: `${habit.name} — streak kept alive.` });
  };

  return (
    <div className="m-controller-page flex flex-col gap-5">
      <header className="m-anim-slide-up">
        <p className="m-eyebrow">Daily habits</p>
        <h1 className="mt-1 text-[28px] font-semibold tracking-tight text-[var(--m-text)]">
          Keep the rhythm
        </h1>
        <p className="mt-1.5 text-[13px] leading-snug text-[var(--m-text-2)]">
          {total === 0 ? "No habits yet — add your first below." : `${doneCount} of ${total} done today. Swipe right to complete.`}
        </p>
      </header>

      {total > 0 && (
        <div
          className="m-anim-slide-up"
          style={{ animationDelay: "40ms" }}
          role="progressbar"
          aria-label="Habits completed today"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={doneCount}
        >
          <div className="h-2 overflow-hidden rounded-full bg-[var(--m-surface-3)]">
            <div
              className="h-full rounded-full bg-[var(--m-primary)] transition-[width] duration-500"
              style={{ width: `${total ? (doneCount / total) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {isError && (
        <MobileErrorState
          title="Habits unavailable"
          onRetry={() => void refetch()}
        />
      )}

      <div className="flex flex-col gap-2.5">
        {isLoading &&
          Array.from({ length: 3 }).map((_, i) => <div key={i} className="m-skeleton h-[68px] rounded-xl" />)}

        {(habits ?? []).map((habit, i) => {
          const done = (completionQueries[i]?.data ?? []).length > 0;
          return (
            <div key={habit.id} className="m-stagger" style={{ ["--m-i" as string]: i }}>
              <SwipeCard
                completed={done}
                disabled={completeMutation.isPending}
                onComplete={() => handleComplete(habit, done)}
              >
                <div className="flex items-center gap-3 pr-6">
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-[14px] font-medium ${done ? "text-[var(--m-text-3)] line-through" : "text-[var(--m-text)]"}`}>
                      {habit.name}
                    </p>
                    <div className="mt-0.5 flex items-center gap-2">
                      <StreakFlame streak={habit.streakCount} size="sm" />
                      {habit.targetMetric && <span className="truncate text-[11px] text-[var(--m-text-3)]">{habit.targetMetric}</span>}
                    </div>
                  </div>
                  <TogglePill
                    checked={done}
                    disabled={completeMutation.isPending}
                    onChange={() => handleComplete(habit, done)}
                    label={
                      done
                        ? `Mark ${habit.name} as not done`
                        : `Complete ${habit.name}`
                    }
                  />
                </div>
              </SwipeCard>
            </div>
          );
        })}

        {!isLoading && total === 0 && <EmptyHabits />}
      </div>

      <AddHabitButton />
    </div>
  );
}

function EmptyHabits() {
  return (
    <div className="m-inset flex flex-col items-center gap-2 px-6 py-10 text-center">
      <p className="text-sm font-medium text-[var(--m-text-2)]">Build your first habit</p>
      <p className="text-[12px] leading-relaxed text-[var(--m-text-3)]">
        Small daily wins compound. Start with something tiny — 2 minutes counts.
      </p>
    </div>
  );
}

function AddHabitButton() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [metric, setMetric] = useState("");

  const createMutation = useMutation({
    mutationFn: (payload: { name: string; targetMetric?: string }) => api.post("/api/habits", payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.habits.all });
      setOpen(false);
      setName("");
      setMetric("");
      notify({ title: "Habit added", body: "Now go earn that streak." });
    },
  });

  const submit = () => {
    if (!name.trim()) return;
    createMutation.mutate({ name: name.trim(), targetMetric: metric.trim() || undefined });
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="m-secondary-button m-press flex w-full items-center justify-center gap-2 text-[13px]"
      >
        <Plus width={16} height={16} strokeWidth={2.2} />
        New habit
      </button>
    );
  }

  return (
    <form
      className="m-card m-anim-pop p-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-[15px] font-semibold">New habit</p>
          <p className="text-[11px] text-[var(--m-text-3)]">
            Keep it small and repeatable.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="m-icon-button m-press"
          aria-label="Cancel new habit"
        >
          <X width={16} height={16} />
        </button>
      </div>
      <label
        htmlFor="habit-name"
        className="mb-1.5 block text-[12px] font-semibold text-[var(--m-text)]"
      >
        Habit
      </label>
      <input
        id="habit-name"
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Read 10 pages"
        className="m-field w-full"
      />
      <label
        htmlFor="habit-target"
        className="mb-1.5 mt-3 block text-[12px] font-semibold text-[var(--m-text)]"
      >
        Daily target <span className="font-normal text-[var(--m-text-3)]">(optional)</span>
      </label>
      <input
        id="habit-target"
        value={metric}
        onChange={(e) => setMetric(e.target.value)}
        placeholder="e.g. 20 min"
        className="m-field w-full"
      />
      {createMutation.isError && (
        <p className="mt-3 text-[12px] text-red-700" role="alert">
          Couldn’t add this habit. Please try again.
        </p>
      )}
      <button
        type="submit"
        disabled={!name.trim() || createMutation.isPending}
        className="m-primary-button m-press mt-4 w-full"
      >
        {createMutation.isPending ? "Adding…" : "Add habit"}
      </button>
    </form>
  );
}
