import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { addDays, format, startOfWeek, startOfDay, endOfDay, isSameDay } from "date-fns";
import {
  CalendarDays,
  Check,
  ChevronDown,
  Circle,
  Plus,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { api } from "@/lib/api";
import { queryKeys, type Event, type Task } from "@/lib/query-keys";
import { expandEvents, isOccurrenceComplete } from "@/lib/recurrence";
import { completedItemCount, isTaskComplete, tasksDueOn } from "@/lib/tasks";
import {
  eventPalette,
  paletteById,
  scheduleItemKind,
  SCHEDULE_ITEM_META,
} from "@/lib/event-meta";
import { openQuickCapture } from "@/components/mobile/quick-action-sheet";
import { MobileErrorState } from "@/components/mobile/error-state";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/m/calendar")({
  validateSearch: (search: Record<string, unknown>): { new?: boolean } => ({
    new: search.new === "1" ? true : undefined,
  }),
  component: MobileCalendar,
});

function MobileCalendar() {
  const { new: openNew } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [selected, setSelected] = useState(() => startOfDay(new Date()));
  const [weekAnchor, setWeekAnchor] = useState(() => startOfDay(new Date()));
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(
    () => new Set(),
  );
  const now = new Date();

  useEffect(() => {
    if (openNew) {
      openQuickCapture({
        kind: "event",
        date: format(selected, "yyyy-MM-dd"),
      });
      void navigate({ to: "/m/calendar", search: {}, replace: true });
    }
  }, [openNew, navigate, selected]);

  const weekDays = useMemo(() => {
    const first = startOfWeek(weekAnchor, { weekStartsOn: 1 });
    return Array.from({ length: 7 }, (_, i) => addDays(first, i));
  }, [weekAnchor]);

  const fromStr = format(weekDays[0], "yyyy-MM-dd");
  const toStr = format(weekDays[6], "yyyy-MM-dd");
  const weekStart = startOfDay(weekDays[0]);
  const weekEnd = endOfDay(weekDays[6]);

  const {
    data: events,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: queryKeys.events.range(fromStr, toStr),
    queryFn: () =>
      api.get<Event[]>(
        `/api/events?from=${weekStart.toISOString()}&to=${weekEnd.toISOString()}`,
      ),
    staleTime: 15_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });

  // Tasks live in their own table, so the calendar has to ask for them
  // separately or dated tasks never appear on the day they are due.
  const { data: tasks } = useQuery({
    queryKey: queryKeys.tasks.range(fromStr, toStr),
    queryFn: () =>
      api.get<Task[]>(
        `/api/tasks?from=${weekStart.toISOString()}&to=${weekEnd.toISOString()}`,
      ),
    staleTime: 15_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });

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

  const weekOccurrences = useMemo(
    () => expandEvents(events ?? [], weekStart, weekEnd),
    [events, weekStart.getTime(), weekEnd.getTime()],
  );

  const dayOccurrences = useMemo(
    () =>
      weekOccurrences.filter(
        (occurrence) =>
          occurrence.occurrenceStart.getTime() <= endOfDay(selected).getTime() &&
          occurrence.occurrenceEnd.getTime() >= startOfDay(selected).getTime(),
      ),
    [weekOccurrences, selected.getTime()],
  );

  const dayTasks = useMemo(
    () => tasksDueOn(tasks, selected),
    [tasks, selected.getTime()],
  );
  const dayItemCount = dayOccurrences.length + dayTasks.length;

  const toggleTaskExpanded = (taskId: string) => {
    setExpandedTaskIds((current) => {
      const next = new Set(current);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  return (
    <div className="m-controller-page flex flex-col gap-4">
      <header className="m-anim-slide-up flex items-center justify-between">
        <div>
          <p className="m-eyebrow">Calendar</p>
          <h1 className="mt-1 text-[28px] font-semibold tracking-tight text-[var(--m-text)]">
            {format(selected, "MMMM yyyy")}
          </h1>
        </div>
        <button
          type="button"
          onClick={() =>
            openQuickCapture({
              kind: "event",
              date: format(selected, "yyyy-MM-dd"),
            })
          }
          aria-label="Add event"
          aria-haspopup="dialog"
          className="m-press flex h-12 w-12 items-center justify-center rounded-full bg-[var(--m-primary)] text-[var(--m-primary-fg)] shadow-[0_8px_20px_rgba(0,0,0,0.16)]"
        >
          <Plus width={19} height={19} strokeWidth={2.3} />
        </button>
      </header>

      {isError && (
        <MobileErrorState
          title="Calendar unavailable"
          onRetry={() => void refetch()}
        />
      )}

      <section
        className="m-calendar-week-strip m-anim-slide-up"
        style={{ animationDelay: "40ms" }}
        aria-label={`Week of ${format(weekDays[0], "MMMM d")}`}
      >
        <div className="mb-3 flex items-center justify-between">
          <button
            type="button"
            onClick={() => {
              setWeekAnchor((day) => addDays(day, -7));
              setSelected((day) => addDays(day, -7));
            }}
            className="m-press flex h-11 w-11 items-center justify-center rounded-full text-[var(--m-text-2)] hover:bg-[var(--m-surface-2)]"
            aria-label="Previous week"
          >
            <ChevronLeft width={17} height={17} />
          </button>
          <button
            type="button"
            onClick={() => {
              setWeekAnchor(startOfDay(new Date()));
              setSelected(startOfDay(new Date()));
            }}
            className="m-press min-h-9 rounded-full bg-white/[0.055] px-4 text-[11px] font-semibold text-[var(--m-text-2)]"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => {
              setWeekAnchor((day) => addDays(day, 7));
              setSelected((day) => addDays(day, 7));
            }}
            className="m-press flex h-11 w-11 items-center justify-center rounded-full text-[var(--m-text-2)] hover:bg-[var(--m-surface-2)]"
            aria-label="Next week"
          >
            <ChevronRight width={17} height={17} />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-0.5 border-t border-[var(--m-border)] pt-3">
          {weekDays.map((day) => {
            const active = isSameDay(day, selected);
            const isToday = isSameDay(day, now);
            const hasItems =
              weekOccurrences.some(
                (occurrence) =>
                  occurrence.occurrenceStart.getTime() <= endOfDay(day).getTime() &&
                  occurrence.occurrenceEnd.getTime() >= startOfDay(day).getTime(),
              ) || tasksDueOn(tasks, day).length > 0;
            return (
              <button
                key={day.toISOString()}
                type="button"
                onClick={() => setSelected(day)}
                aria-label={format(day, "EEEE, MMMM d")}
                aria-pressed={active}
                className="m-calendar-day m-press"
              >
                <span className={cn("text-[9px] font-semibold uppercase", active ? "text-[var(--m-text-2)]" : "text-[var(--m-text-3)]")}>
                  {format(day, "EEEEE")}
                </span>
                <span
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-full text-[15px] font-semibold tabular-nums",
                    active
                      ? "bg-[var(--m-primary)] text-[var(--m-primary-fg)] shadow-[0_3px_0_rgba(0,0,0,0.25)]"
                      : isToday
                        ? "ring-1 ring-[#c6ff77]/70 text-[var(--m-text)]"
                        : "text-[var(--m-text-2)]",
                  )}
                >
                  {format(day, "d")}
                </span>
                <span
                  className={cn(
                    "h-1 w-1 rounded-full",
                    hasItems
                      ? active
                        ? "bg-[var(--m-primary-fg)]"
                        : "bg-[var(--m-text)]"
                      : isToday && !active
                        ? "bg-[var(--m-text-3)]"
                        : "bg-transparent",
                  )}
                />
              </button>
            );
          })}
        </div>
      </section>

      <section className="m-calendar-agenda m-anim-slide-up" style={{ animationDelay: "80ms" }}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="text-[42px] font-light leading-none tracking-[-0.05em] text-[var(--m-text)]">
              {format(selected, "d")}
            </span>
            <div>
              <h2 className="text-[15px] font-semibold text-[var(--m-text)]">
                {isSameDay(selected, now) ? "Today" : format(selected, "EEEE")}
              </h2>
              <p className="mt-0.5 text-[11px] text-[var(--m-text-3)]">
                {format(selected, "MMMM yyyy")}
              </p>
            </div>
          </div>
          <span className="rounded-full border border-[var(--m-border)] bg-white/[0.04] px-2.5 py-1 text-[10px] font-semibold text-[var(--m-text-3)]">
            {dayItemCount === 0
              ? "Open"
              : `${dayItemCount} ${dayItemCount === 1 ? "item" : "items"}`}
          </span>
        </div>
        {isLoading ? (
          <div className="space-y-2" aria-label="Loading calendar">
            <div className="m-skeleton h-16 rounded-xl" />
            <div className="m-skeleton h-16 rounded-xl" />
          </div>
        ) : dayItemCount === 0 ? (
          <div className="m-calendar-empty">
            <CalendarDays width={24} height={24} className="text-[var(--m-text-3)]" />
            <p className="mt-3 text-[14px] font-semibold text-[var(--m-text)]">No items</p>
            <p className="mt-1 text-[11px] text-[var(--m-text-3)]">Your day is free.</p>
            <button
              type="button"
              onClick={() =>
                openQuickCapture({
                  kind: "event",
                  date: format(selected, "yyyy-MM-dd"),
                })
              }
              className="m-press mt-4 min-h-11 rounded-full bg-[var(--m-primary)] px-5 text-[12px] font-semibold text-[var(--m-primary-fg)]"
            >
              Add event
            </button>
          </div>
        ) : (
          <div className="m-calendar-event-list">
            {dayOccurrences.map((occurrence) => {
              const isPast = occurrence.occurrenceEnd.getTime() < now.getTime();
              const completed = isOccurrenceComplete(occurrence);
              const kind = scheduleItemKind(occurrence.event);
              const kindMeta = SCHEDULE_ITEM_META[kind];
              const palette = eventPalette(occurrence.event);
              const occurrenceStatus = completed
                ? "Done"
                : isPast
                  ? "Overdue"
                  : occurrence.event.isAllDay
                    ? "All-day"
                    : `${format(occurrence.occurrenceStart, "h:mm a")} – ${format(occurrence.occurrenceEnd, "h:mm a")}`;
              const eventContent = (
                <>
                  <span
                    className="m-calendar-event-accent"
                    style={{ backgroundColor: palette.hex }}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold text-[var(--m-text)]">
                      {occurrence.event.title}
                    </span>
                    <span className="mt-1 block text-[11px] text-[var(--m-text-3)]">
                      {kindMeta.label} · {occurrenceStatus}
                      {occurrence.isRecurring ? " · Repeats" : ""}
                    </span>
                  </span>
                </>
              );

              return (
                <div
                  key={`${occurrence.event.id}-${occurrence.occurrenceStart.toISOString()}`}
                  className={cn("m-calendar-event-row", completed && "opacity-50")}
                >
                  <span className="w-11 shrink-0 pt-0.5 text-right text-[11px] font-medium tabular-nums text-[var(--m-text-3)]">
                    {occurrence.event.isAllDay
                      ? "all-day"
                      : format(occurrence.occurrenceStart, "h:mm")}
                  </span>
                  {occurrence.event.link ? (
                    <a
                      href={occurrence.event.link}
                      target="_blank"
                      rel="noreferrer"
                      className="m-press flex min-w-0 flex-1 gap-3 rounded-xl px-3 py-2.5 hover:bg-white/[0.04]"
                    >
                      {eventContent}
                    </a>
                  ) : (
                    <div className="flex min-w-0 flex-1 gap-3 px-3 py-2.5">
                      {eventContent}
                    </div>
                  )}
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
                    className={cn(
                      "m-press mr-1 flex h-9 w-9 shrink-0 items-center justify-center self-center rounded-full border disabled:opacity-40",
                      completed
                        ? "border-[#c6ff77]/60 bg-[#c6ff77] text-[#111210]"
                        : "border-[var(--m-border)] text-[var(--m-text-3)]",
                    )}
                  >
                    {completed ? (
                      <Check width={15} height={15} strokeWidth={3} />
                    ) : (
                      <Circle width={15} height={15} strokeWidth={2} />
                    )}
                  </button>
                </div>
              );
            })}

            {dayTasks.map((task) => {
              const dueAt = new Date(task.dueAt as string);
              const completed = isTaskComplete(task);
              const doneCount = completedItemCount(task);
              const expanded = expandedTaskIds.has(task.id);
              const overdue = !completed && dueAt.getTime() < now.getTime();
              const palette = paletteById("amber");

              return (
                <div
                  key={`task-${task.id}`}
                  className={cn(
                    "m-calendar-event-row items-start",
                    completed && "opacity-50",
                  )}
                >
                  <span className="w-11 shrink-0 pt-3 text-right text-[11px] font-medium tabular-nums text-[var(--m-text-3)]">
                    {format(dueAt, "h:mm")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => toggleTaskExpanded(task.id)}
                      aria-expanded={expanded}
                      className="m-press flex w-full min-w-0 gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-white/[0.04]"
                    >
                      <span
                        className="m-calendar-event-accent"
                        style={{ backgroundColor: palette.hex }}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            "block truncate text-[14px] font-semibold text-[var(--m-text)]",
                            completed && "line-through",
                          )}
                        >
                          {task.title}
                        </span>
                        <span className="mt-1 block text-[11px] text-[var(--m-text-3)]">
                          {SCHEDULE_ITEM_META.task.label} ·{" "}
                          {completed
                            ? "Done"
                            : overdue
                              ? "Overdue"
                              : `${doneCount}/${task.items.length} done`}
                        </span>
                      </span>
                      <ChevronDown
                        width={15}
                        height={15}
                        aria-hidden="true"
                        className={cn(
                          "mt-1 shrink-0 text-[var(--m-text-3)] transition-transform",
                          expanded && "rotate-180",
                        )}
                      />
                    </button>

                    {expanded && (
                      <div className="mb-2 ml-3 space-y-1 border-l border-[var(--m-border)] pl-4">
                        {task.items.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() =>
                              toggleTaskItemMutation.mutate({
                                taskId: task.id,
                                itemId: item.id,
                              })
                            }
                            disabled={toggleTaskItemMutation.isPending}
                            aria-pressed={item.completed}
                            className="m-press flex min-h-9 w-full items-center gap-2 text-left disabled:opacity-40"
                          >
                            {item.completed ? (
                              <Check
                                width={13}
                                height={13}
                                strokeWidth={3}
                                className="shrink-0 text-[var(--m-text-2)]"
                              />
                            ) : (
                              <Circle
                                width={13}
                                height={13}
                                strokeWidth={2}
                                className="shrink-0 text-[var(--m-text-3)]"
                              />
                            )}
                            <span
                              className={cn(
                                "min-w-0 flex-1 truncate text-[12px] text-[var(--m-text-2)]",
                                item.completed && "line-through opacity-60",
                              )}
                            >
                              {item.label}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <span
                    aria-hidden="true"
                    className={cn(
                      "mr-1 mt-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border",
                      completed
                        ? "border-[#c6ff77]/60 bg-[#c6ff77] text-[#111210]"
                        : "border-[var(--m-border)] text-[var(--m-text-3)]",
                    )}
                  >
                    {completed ? (
                      <Check width={15} height={15} strokeWidth={3} />
                    ) : (
                      <span className="text-[10px] font-bold tabular-nums">
                        {doneCount}/{task.items.length}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
