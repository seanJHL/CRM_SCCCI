import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { format, startOfDay, endOfDay } from "date-fns";
import {
  CalendarDays,
  Check,
  ChevronDown,
  Circle,
  Dumbbell,
  Flame as FlameIcon,
  Plus,
  Radio,
  Trash2,
} from "lucide-react";
import { api } from "@/lib/api";
import { queryKeys, type Event, type Habit, type HabitCompletion, type StreaksData, type Task } from "@/lib/query-keys";
import { expandEvents, isOccurrenceComplete, type EventOccurrence } from "@/lib/recurrence";
import { isTaskComplete } from "@/lib/tasks";
import { scheduleItemKind, SCHEDULE_ITEM_META } from "@/lib/event-meta";
import { MobileErrorState } from "@/components/mobile/error-state";
import { InstallPrompt } from "@/components/mobile/install-prompt";
import {
  openQuickCapture,
} from "@/components/mobile/quick-action-sheet";

export const Route = createFileRoute("/m/")({
  component: MobileHome,
});

type QueueItem =
  | { kind: "event"; occurrence: EventOccurrence }
  | { kind: "task"; task: Task };

function isQueueItemComplete(item: QueueItem) {
  return item.kind === "event" ? isOccurrenceComplete(item.occurrence) : isTaskComplete(item.task);
}

function queueItemStart(item: QueueItem): Date | null {
  return item.kind === "event" ? item.occurrence.occurrenceStart : item.task.dueAt ? new Date(item.task.dueAt) : null;
}

function queueItemEnd(item: QueueItem): Date | null {
  return item.kind === "event" ? item.occurrence.occurrenceEnd : item.task.dueAt ? new Date(item.task.dueAt) : null;
}

function queueItemTitle(item: QueueItem): string {
  return item.kind === "event" ? item.occurrence.event.title : item.task.title;
}

function queueItemKey(item: QueueItem): string {
  return item.kind === "event"
    ? `event-${item.occurrence.event.id}-${item.occurrence.occurrenceStart.toISOString()}`
    : `task-${item.task.id}`;
}

function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
  return now;
}

function MobileHome() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const now = useNow();
  const dayStart = startOfDay(now);
  const dayEnd = endOfDay(now);
  const fromStr = format(dayStart, "yyyy-MM-dd");
  const toStr = format(dayEnd, "yyyy-MM-dd");
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(new Set());

  const {
    data: events,
    isLoading: eventsLoading,
    isError: eventsError,
    refetch: refetchEvents,
  } = useQuery({
    queryKey: queryKeys.events.range(fromStr, toStr),
    queryFn: () =>
      api.get<Event[]>(
        `/api/events?from=${dayStart.toISOString()}&to=${dayEnd.toISOString()}`,
      ),
    staleTime: 15_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });

  const {
    data: tasksData,
    isLoading: tasksLoading,
    isError: tasksError,
    refetch: refetchTasks,
  } = useQuery({
    queryKey: queryKeys.tasks.range(fromStr, toStr),
    queryFn: () =>
      api.get<Task[]>(
        `/api/tasks?from=${dayStart.toISOString()}&to=${dayEnd.toISOString()}`,
      ),
    staleTime: 15_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });
  const tasksForToday = useMemo(() => tasksData ?? [], [tasksData]);

  const {
    data: habits,
    isLoading: habitsLoading,
    isError: habitsError,
    refetch: refetchHabits,
  } = useQuery({
    queryKey: queryKeys.habits.all,
    queryFn: () => api.get<Habit[]>("/api/habits"),
    staleTime: 120_000,
  });

  const completionQueries = useQueries({
    queries: (habits ?? []).map((habit) => ({
      queryKey: queryKeys.habits.completions(habit.id, fromStr, toStr),
      queryFn: () =>
        api.get<HabitCompletion[]>(
          `/api/habits/${habit.id}/completions?from=${dayStart.toISOString()}&to=${dayEnd.toISOString()}`,
        ),
      staleTime: 60_000,
    })),
  });

  const { data: streaks } = useQuery({
    queryKey: queryKeys.analytics.streaks,
    queryFn: () => api.get<StreaksData>("/api/analytics/streaks"),
    staleTime: 120_000,
  });

  const occurrences = useMemo(
    () => expandEvents(events ?? [], dayStart, dayEnd),
    [events, dayStart.getTime(), dayEnd.getTime()],
  );

  const queueItems = useMemo<QueueItem[]>(
    () => [
      ...occurrences.map((occurrence): QueueItem => ({ kind: "event", occurrence })),
      ...tasksForToday.map((task): QueueItem => ({ kind: "task", task })),
    ],
    [occurrences, tasksForToday],
  );

  const missionQueue = useMemo(() => {
    const incomplete = queueItems.filter((item) => !isQueueItemComplete(item));
    const active = incomplete.filter((item) => {
      const end = queueItemEnd(item);
      return !end || end.getTime() >= now.getTime();
    });
    const overdue = incomplete
      .filter((item) => {
        const end = queueItemEnd(item);
        return !!end && end.getTime() < now.getTime();
      })
      .reverse();
    const completed = queueItems.filter(isQueueItemComplete).reverse();
    return [...active, ...overdue, ...completed];
  }, [queueItems, now.getTime()]);

  const toggleCompletionMutation = useMutation({
    mutationFn: ({ eventId, occurrenceStart }: { eventId: string; occurrenceStart: string }) =>
      api.post(`/api/events/${eventId}/completions/toggle`, {
        occurrenceStart,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.events.all });
    },
  });

  const toggleTaskItemMutation = useMutation({
    mutationFn: ({ taskId, itemId }: { taskId: string; itemId: string }) =>
      api.post(`/api/tasks/${taskId}/items/${itemId}/toggle`, {}),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
    },
  });

  const deleteTaskMutation = useMutation({
    mutationFn: (taskId: string) => api.delete(`/api/tasks/${taskId}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
    },
  });

  const toggleTaskExpanded = (taskId: string) => {
    setExpandedTaskIds((current) => {
      const next = new Set(current);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const habitsDone = completionQueries.filter((q) => (q.data ?? []).length > 0).length;
  const habitsTotal = habits?.length ?? 0;
  const agendaDone = queueItems.filter(isQueueItemComplete).length;
  const agendaTotal = queueItems.length;
  const agendaLoading = eventsLoading || tasksLoading;
  const nextItem = missionQueue.find((item) => !isQueueItemComplete(item));
  const nextStart = nextItem ? queueItemStart(nextItem) : null;
  const nextEnd = nextItem ? queueItemEnd(nextItem) : null;
  const nextMissionStatus = !nextItem
    ? "READY FOR INPUT"
    : !nextStart
      ? "OPEN · NO DUE DATE"
      : nextStart.getTime() > now.getTime()
        ? `${format(nextStart, "HH:mm")} · T−${Math.max(
            0,
            Math.round((nextStart.getTime() - now.getTime()) / 60_000),
          )} MIN`
        : nextItem.kind === "event" && nextEnd && nextEnd.getTime() >= now.getTime()
          ? `IN PROGRESS · UNTIL ${format(nextEnd, "HH:mm")}`
          : `OVERDUE · ${nextItem.kind === "event" ? "ENDED" : "DUE"} ${format(nextEnd ?? nextStart, "HH:mm")}`;
  const totalItems = habitsTotal + agendaTotal;
  const doneItems = habitsDone + agendaDone;
  const progress = totalItems > 0 ? doneItems / totalItems : 0;
  const dataLoading = agendaLoading || habitsLoading;

  const bestHabitStreak = useMemo(
    () => (streaks?.habitStreaks ?? []).reduce((max, h) => Math.max(max, h.streakCount), 0),
    [streaks],
  );

  const hour = now.getHours();
  const greeting = hour < 5 ? "Night owl mode" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="m-controller-page flex flex-col gap-4">
      <header className="m-anim-slide-up flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--m-primary)] text-[var(--m-primary-fg)]">
            <FlameIcon width={18} height={18} fill="currentColor" />
          </span>
          <div>
            <p className="text-[14px] font-semibold leading-tight text-[var(--m-text)]">
              Ember
            </p>
            <p className="text-[11px] text-[var(--m-text-3)]">
              {format(now, "EEEE, MMM d")}
            </p>
          </div>
        </div>
      </header>

      <section
        className="m-remote-controller m-anim-slide-up"
        style={{ animationDelay: "35ms" }}
        aria-labelledby="day-controller-title"
      >
        <div className="flex items-center justify-between px-1">
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-white/45">
              Ember RC-01
            </p>
            <h1 id="day-controller-title" className="mt-0.5 text-[15px] font-semibold text-white">
              {greeting}
            </h1>
          </div>
          <div className="text-right">
            <span className="flex items-center justify-end gap-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-[#c6ff77]">
              <Radio width={10} height={10} />
              Live
            </span>
            <p className="mt-0.5 font-mono text-[13px] tabular-nums text-white">
              {format(now, "HH:mm")}
            </p>
          </div>
        </div>

        <div className="m-remote-display mt-4" aria-live="polite">
          <div className="m-remote-display-status">
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-black/70" />
              RC link stable
            </span>
            <span>{format(now, "MMM d")} // Day mode</span>
          </div>

          <div className="mt-4 flex items-start justify-between gap-4 border-b border-black/15 pb-4">
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-black/50">
                Next mission
              </p>
              <p className="m-remote-display-title mt-1.5 truncate text-[25px] font-semibold leading-tight tracking-[-0.04em] text-black">
                {agendaLoading
                  ? "Scanning schedule…"
                  : nextItem ? queueItemTitle(nextItem) : "Channel clear"}
              </p>
              <p className="mt-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-black/55">
                {nextMissionStatus}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="font-mono text-[8px] font-bold uppercase tracking-[0.14em] text-black/45">
                Progress
              </p>
              <p className="mt-1 font-mono text-[22px] font-black leading-none tabular-nums text-black">
                {dataLoading || totalItems === 0 ? "—" : `${Math.round(progress * 100)}%`}
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-black/45">
              <span>Mission queue</span>
              <span>{agendaTotal.toString().padStart(2, "0")} items</span>
            </div>
            {agendaLoading ? (
              <p className="py-3 font-mono text-[11px] text-black/55">Receiving calendar data…</p>
            ) : queueItems.length === 0 ? (
              <button
                type="button"
                onClick={() => openQuickCapture({ kind: "event" })}
                className="m-press flex min-h-[52px] w-full items-center justify-between rounded-xl border border-dashed border-black/25 bg-black/[0.035] px-3.5 text-left font-mono text-[11px] font-bold text-black/65"
              >
                No items queued
                <Plus width={14} height={14} />
              </button>
            ) : (
              <div className="max-h-[168px] space-y-2 overflow-y-auto pr-1">
                {missionQueue.map((item) => {
                  if (item.kind === "event") {
                    const { occurrence } = item;
                    const kind = scheduleItemKind(occurrence.event);
                    const completed = isOccurrenceComplete(occurrence);
                    return (
                      <div
                        key={queueItemKey(item)}
                        className={`flex min-h-8 items-center gap-2 border-t border-black/10 pt-1.5 font-mono ${completed ? "opacity-50" : ""}`}
                      >
                        <span className="w-12 shrink-0 text-[10px] font-bold tabular-nums text-black/55">
                          {occurrence.event.isAllDay ? "ALL" : format(occurrence.occurrenceStart, "HH:mm")}
                        </span>
                        <span className={`min-w-0 flex-1 truncate text-[11px] font-semibold text-black/80 ${completed ? "line-through" : ""}`}>
                          {occurrence.event.title}
                        </span>
                        <span className="text-[8px] font-black tracking-[0.08em] text-black/45">
                          {SCHEDULE_ITEM_META[kind].shortLabel}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            toggleCompletionMutation.mutate({
                              eventId: occurrence.event.id,
                              occurrenceStart: occurrence.occurrenceStart.toISOString(),
                            })
                          }
                          disabled={toggleCompletionMutation.isPending}
                          aria-label={`Mark ${occurrence.event.title} ${completed ? "not done" : "done"}`}
                          aria-pressed={completed}
                          className="m-press flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-black/20 text-black/65 disabled:opacity-40"
                        >
                          {completed ? (
                            <Check width={13} height={13} strokeWidth={3} />
                          ) : (
                            <Circle width={13} height={13} strokeWidth={2} />
                          )}
                        </button>
                      </div>
                    );
                  }

                  const { task } = item;
                  const completed = isTaskComplete(task);
                  const doneCount = task.items.filter((i) => i.completed).length;
                  const expanded = expandedTaskIds.has(task.id);
                  return (
                    <div key={queueItemKey(item)} className={`border-t border-black/10 pt-1.5 font-mono ${completed ? "opacity-50" : ""}`}>
                      <button
                        type="button"
                        onClick={() => toggleTaskExpanded(task.id)}
                        aria-expanded={expanded}
                        className="flex min-h-8 w-full items-center gap-2 text-left"
                      >
                        <span className="w-12 shrink-0 text-[10px] font-bold tabular-nums text-black/55">
                          {task.dueAt ? format(new Date(task.dueAt), "HH:mm") : "—"}
                        </span>
                        <span className={`min-w-0 flex-1 truncate text-[11px] font-semibold text-black/80 ${completed ? "line-through" : ""}`}>
                          {task.title}
                        </span>
                        <span className="shrink-0 text-[9px] font-bold tabular-nums text-black/55">
                          {doneCount}/{task.items.length}
                        </span>
                        <span className="text-[8px] font-black tracking-[0.08em] text-black/45">
                          {SCHEDULE_ITEM_META.task.shortLabel}
                        </span>
                        <ChevronDown
                          width={13}
                          height={13}
                          className={`shrink-0 text-black/45 transition-transform ${expanded ? "rotate-180" : ""}`}
                        />
                      </button>
                      {expanded && (
                        <div className="ml-12 mb-1.5 space-y-1 border-l border-black/10 pl-3">
                          {task.items.map((taskItem) => (
                            <button
                              key={taskItem.id}
                              type="button"
                              onClick={() =>
                                toggleTaskItemMutation.mutate({ taskId: task.id, itemId: taskItem.id })
                              }
                              disabled={toggleTaskItemMutation.isPending}
                              aria-pressed={taskItem.completed}
                              className="flex w-full items-center gap-1.5 py-0.5 text-left disabled:opacity-40"
                            >
                              {taskItem.completed ? (
                                <Check width={11} height={11} strokeWidth={3} className="shrink-0 text-black/60" />
                              ) : (
                                <Circle width={11} height={11} strokeWidth={2} className="shrink-0 text-black/40" />
                              )}
                              <span className={`min-w-0 flex-1 truncate text-[10.5px] text-black/70 ${taskItem.completed ? "line-through opacity-60" : ""}`}>
                                {taskItem.label}
                              </span>
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={() => deleteTaskMutation.mutate(task.id)}
                            disabled={deleteTaskMutation.isPending}
                            className="mt-1 flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.06em] text-black/40 disabled:opacity-40"
                          >
                            <Trash2 width={10} height={10} /> Delete task
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="m-remote-kpi-grid" aria-label="Today’s key performance indicators">
            <RemoteStat
              label="Habits"
              value={habitsLoading ? "—" : `${habitsDone}/${habitsTotal}`}
            />
            <RemoteStat
              label="Agenda"
              value={agendaLoading ? "—" : `${agendaDone}/${agendaTotal}`}
            />
            <RemoteStat
              label="Streak"
              value={`${Math.max(bestHabitStreak, streaks?.workoutStreak ?? 0)}d`}
            />
          </div>

          <div className="mt-4 flex items-center justify-between font-mono text-[8px] font-bold uppercase tracking-[0.16em] text-black/45">
            <span>Daily XP</span>
            <span>{doneItems}/{totalItems || 0} complete</span>
          </div>
          <div className="m-remote-progress-track mt-1.5" aria-hidden="true">
            <div
              className="m-remote-progress-fill"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <ControlButton
            icon={Plus}
            label="Event"
            hint="Schedule it"
            onClick={() => openQuickCapture({ kind: "event" })}
            active
          />
          <ControlButton
            icon={Check}
            label="Task"
            hint="Make a checklist"
            onClick={() => openQuickCapture({ kind: "task" })}
          />
          <ControlButton
            icon={Dumbbell}
            label="Workout"
            hint="Build or start"
            onClick={() => void navigate({ to: "/m/workouts" })}
          />
          <ControlButton
            icon={CalendarDays}
            label="Calendar"
            hint="Open schedule"
            onClick={() => void navigate({ to: "/m/calendar" })}
          />
        </div>

        <div className="mt-4 flex items-center justify-between px-1 font-mono text-[8px] font-bold uppercase tracking-[0.18em] text-white/35">
          <span>Four controls armed</span>
          <span>Calendar linked</span>
        </div>
      </section>

      {(eventsError || habitsError || tasksError) && (
        <MobileErrorState
          title="Your day is out of reach"
          message="We couldn’t refresh your calendar data."
          onRetry={() => {
            void Promise.all([refetchEvents(), refetchHabits(), refetchTasks()]);
          }}
        />
      )}

      <InstallPrompt />

    </div>
  );
}

function ControlButton({
  icon: Icon,
  label,
  hint,
  onClick,
  active = false,
}: {
  icon: React.ComponentType<{ width?: number; height?: number; strokeWidth?: number; className?: string }>;
  label: string;
  hint: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`m-remote-button m-press min-w-0 text-left ${
        active
          ? "border-[#c6ff77] bg-[#c6ff77] text-[#111210]"
          : "border-white/10 bg-white/[0.075] text-white"
      }`}
    >
      <Icon width={20} height={20} strokeWidth={2} />
      <span className="mt-3 block truncate text-[14px] font-semibold">{label}</span>
      <span className={`mt-0.5 block truncate text-[10px] ${active ? "text-black/55" : "text-white/45"}`}>
        {hint}
      </span>
    </button>
  );
}

function RemoteStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="m-remote-stat">
      <span className="block truncate font-mono text-[8px] font-black uppercase tracking-[0.15em] text-black/45">
        {label}
      </span>
      <span className="mt-1 block font-mono text-[16px] font-black tabular-nums text-black/80">
        {value}
      </span>
    </div>
  );
}
