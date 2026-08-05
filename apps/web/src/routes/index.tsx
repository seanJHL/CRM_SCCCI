import { createFileRoute, redirect } from "@tanstack/react-router";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  addDays,
  addMonths,
  addWeeks,
  endOfDay,
  format,
  getDaysInMonth,
  isSameDay,
  isSameMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
  subWeeks,
} from "date-fns";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Dumbbell,
  Flame,
  Link2,
  Plus,
  Repeat,
  Timer,
  Trophy,
  Users,
  Zap,
} from "lucide-react";
import { api } from "@/lib/api";
import { loadSession, type SessionData } from "@/lib/crm";
import {
  queryKeys,
  type Event,
  type Habit,
  type HabitCompletion,
  type Reminder,
  type StreaksData,
  type Task,
} from "@/lib/query-keys";
import { Skeleton } from "@/components/ui/skeleton";
import {
  EventDialog,
  type EventPayload,
} from "@/components/calendar/event-dialog";
import {
  collectTags,
  eventPalette,
  paletteById,
  parseTags,
} from "@/lib/event-meta";
import { completedItemCount, isTaskComplete, tasksDueOn } from "@/lib/tasks";
import { expandEvents } from "@/lib/recurrence";
import { useAppPreferences } from "@/lib/preferences";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    let session: SessionData;
    try {
      session = await loadSession();
    } catch {
      throw redirect({ to: "/login", search: { error: undefined } });
    }
    if (!session.google.connected) {
      throw redirect({ to: "/login", search: { error: undefined } });
    }
    return { session };
  },
  component: CalendarHomePage,
});

const WEEKDAYS = {
  0: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  1: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
} as const;
const completionDateKey = (completion: HabitCompletion) =>
  new Date(completion.completedAt).toISOString().slice(0, 10);

function CalendarHomePage() {
  const [today] = useState(() => startOfDay(new Date()));
  const {
    preferences,
    ready: preferencesReady,
  } = useAppPreferences();
  const [currentDate, setCurrentDate] = useState(today);
  const [selectedDate, setSelectedDate] = useState(today);
  const [view, setView] = useState<"month" | "week" | "day">("month");
  const [preferencesApplied, setPreferencesApplied] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);
  const [dialogDate, setDialogDate] = useState<Date>(today);

  useEffect(() => {
    if (!preferencesReady || preferencesApplied) return;
    setView(preferences.calendarDefaultView);
    setPreferencesApplied(true);
  }, [
    preferences.calendarDefaultView,
    preferencesApplied,
    preferencesReady,
  ]);

  const calendarDays = useMemo(() => {
    if (view === "day") {
      return [selectedDate];
    }

    if (view === "week") {
      const firstVisibleDay = startOfWeek(selectedDate, {
        weekStartsOn: preferences.weekStartsOn,
      });
      return Array.from({ length: 7 }, (_, index) =>
        addDays(firstVisibleDay, index),
      );
    }

    const firstVisibleDay = startOfWeek(startOfMonth(currentDate), {
      weekStartsOn: preferences.weekStartsOn,
    });

    // A fixed 42-day grid keeps the calendar height and trailing dates stable.
    return Array.from({ length: 42 }, (_, index) =>
      addDays(firstVisibleDay, index),
    );
  }, [currentDate, preferences.weekStartsOn, selectedDate, view]);

  const fromStr = format(calendarDays[0], "yyyy-MM-dd");
  const toStr = format(calendarDays[calendarDays.length - 1], "yyyy-MM-dd");
  const eventRangeStart = startOfDay(calendarDays[0]);
  const eventRangeEnd = endOfDay(calendarDays[calendarDays.length - 1]);

  const { data: events, isLoading: eventsLoading } = useQuery({
    queryKey: queryKeys.events.range(fromStr, toStr),
    queryFn: () =>
      api.get<Event[]>(
        `/api/events?from=${eventRangeStart.toISOString()}&to=${eventRangeEnd.toISOString()}`,
      ),
    staleTime: 60_000,
    gcTime: 600_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  // Tasks are a separate entity from events, so the calendar has to ask for
  // them explicitly or dated tasks never land on the day they are due.
  const { data: tasks } = useQuery({
    queryKey: queryKeys.tasks.range(fromStr, toStr),
    queryFn: () =>
      api.get<Task[]>(
        `/api/tasks?from=${eventRangeStart.toISOString()}&to=${eventRangeEnd.toISOString()}`,
      ),
    staleTime: 60_000,
    gcTime: 600_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  const { data: habits, isLoading: habitsLoading } = useQuery({
    queryKey: queryKeys.habits.all,
    queryFn: () => api.get<Habit[]>("/api/habits"),
    staleTime: 120_000,
    gcTime: 600_000,
  });

  const completionQueries = useQueries({
    queries: (habits ?? []).map((habit) => ({
      queryKey: queryKeys.habits.completions(habit.id, fromStr, toStr),
      queryFn: () =>
        api.get<HabitCompletion[]>(
          `/api/habits/${habit.id}/completions?from=${fromStr}T00:00:00.000Z&to=${toStr}T23:59:59.999Z`,
        ),
      staleTime: 60_000,
      gcTime: 600_000,
    })),
  });

  const { data: reminders } = useQuery({
    queryKey: queryKeys.reminders.all,
    queryFn: () => api.get<Reminder[]>("/api/reminders"),
    staleTime: 300_000,
    gcTime: 900_000,
  });

  const { data: streaks } = useQuery({
    queryKey: queryKeys.analytics.streaks,
    queryFn: () => api.get<StreaksData>("/api/analytics/streaks"),
    staleTime: 120_000,
    gcTime: 600_000,
  });

  const queryClient = useQueryClient();
  const completeMutation = useMutation({
    mutationFn: ({
      habitId,
      completedOn,
    }: {
      habitId: string;
      completedOn: string;
    }) =>
      api.post(`/api/habits/${habitId}/complete`, {
        completedOn,
      }),
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.habits.all });
      queryClient.invalidateQueries({
        queryKey: queryKeys.habits.completions(
          variables.habitId,
          fromStr,
          toStr,
        ),
      });
    },
  });

  const invalidateEvents = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.events.all });

  const createEventMutation = useMutation({
    mutationFn: (payload: EventPayload) =>
      api.post<Event>("/api/events", payload),
    onSuccess: () => setDialogOpen(false),
    onSettled: invalidateEvents,
  });

  const updateEventMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: EventPayload }) =>
      api.patch<Event>(`/api/events/${id}`, payload),
    onSuccess: () => setDialogOpen(false),
    onSettled: invalidateEvents,
  });

  const deleteEventMutation = useMutation({
    mutationFn: (id: string) =>
      api.delete(`/api/events/${id}`, { confirmed: true }),
    onSuccess: () => setDialogOpen(false),
    onSettled: invalidateEvents,
  });

  const toggleTaskItemMutation = useMutation({
    mutationFn: ({ taskId, itemId }: { taskId: string; itemId: string }) =>
      api.post(`/api/tasks/${taskId}/items/${itemId}/toggle`, {}),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all }),
  });

  function openCreateDialog(day: Date) {
    setEditingEvent(null);
    setDialogDate(day);
    setDialogOpen(true);
  }

  function openEditDialog(event: Event) {
    setEditingEvent(event);
    setDialogOpen(true);
  }

  function handleEventSubmit(payload: EventPayload) {
    if (editingEvent) {
      updateEventMutation.mutate({ id: editingEvent.id, payload });
    } else {
      createEventMutation.mutate(payload);
    }
  }

  const habitCompletions = completionQueries.flatMap(
    (query) => query.data ?? [],
  );
  const habitsTotal = habits?.length ?? 0;
  const selectedDateKey = format(selectedDate, "yyyy-MM-dd");
  const selectedCompletedHabitIds = new Set(
    habitCompletions
      .filter(
        (completion) => completionDateKey(completion) === selectedDateKey,
      )
      .map((completion) => completion.habitId),
  );
  const habitsDone = selectedCompletedHabitIds.size;
  const activeReminders = reminders?.filter((reminder) => reminder.isActive) ?? [];
  // Expand across the full visible span. Using the last day's midnight as the
  // range end would drop every event later that day — which in day view is
  // every event on screen.
  const expandedOccurrences = useMemo(
    () => expandEvents(events ?? [], eventRangeStart, eventRangeEnd),
    [events, eventRangeStart.getTime(), eventRangeEnd.getTime()],
  );
  const selectedDayOccurrences = useMemo(
    () =>
      expandedOccurrences.filter((occ) =>
        isSameDay(occ.occurrenceStart, selectedDate),
      ),
    [expandedOccurrences, selectedDate],
  );
  const selectedDayTasks = useMemo(
    () => tasksDueOn(tasks, selectedDate),
    [tasks, selectedDate],
  );
  const selectedDayIsEmpty =
    selectedDayOccurrences.length === 0 && selectedDayTasks.length === 0;
  const taskPalette = paletteById("amber");
  const allTags = useMemo(() => collectTags(events), [events]);
  const visibleOccurrences =
    view !== "month"
      ? expandedOccurrences
      : expandedOccurrences.filter((occ) =>
          isSameMonth(occ.occurrenceStart, currentDate),
        );
  const visibleTasks = useMemo(() => {
    const dated = (tasks ?? []).filter((task) => task.dueAt);
    return view !== "month"
      ? dated.filter((task) =>
          calendarDays.some((day) =>
            isSameDay(new Date(task.dueAt as string), day),
          ),
        )
      : dated.filter((task) =>
          isSameMonth(new Date(task.dueAt as string), currentDate),
        );
  }, [tasks, view, calendarDays, currentDate]);
  const visibleCompletions = new Set(
    habitCompletions
      .filter((completion) => {
        const completionKey = completionDateKey(completion);
        return view === "month"
          ? completionKey.startsWith(format(currentDate, "yyyy-MM"))
          : calendarDays.some(
              (day) => format(day, "yyyy-MM-dd") === completionKey,
            );
      })
      .map(
        (completion) =>
          `${completion.habitId}:${completionDateKey(completion)}`,
      ),
  ).size;
  const visibleHabitOpportunities =
    habitsTotal *
    (view === "month" ? getDaysInMonth(currentDate) : calendarDays.length);
  const completionsLoading = completionQueries.some((query) => query.isLoading);
  const calendarTitle =
    view === "month"
      ? format(currentDate, "MMMM yyyy")
      : view === "week"
        ? `${format(calendarDays[0], "d MMM")} – ${format(
            calendarDays[calendarDays.length - 1],
            "d MMM yyyy",
          )}`
        : format(selectedDate, "EEEE, d MMMM yyyy");

  function toggleHabit(habit: Habit) {
    completeMutation.mutate({
      habitId: habit.id,
      completedOn: selectedDateKey,
    });
  }

  function goToPreviousPeriod() {
    if (view === "month") {
      const nextMonth = subMonths(currentDate, 1);
      setCurrentDate(nextMonth);
      setSelectedDate(startOfMonth(nextMonth));
      return;
    }

    const nextDate =
      view === "week" ? subWeeks(selectedDate, 1) : subDays(selectedDate, 1);
    setCurrentDate(nextDate);
    setSelectedDate(nextDate);
  }

  function goToNextPeriod() {
    if (view === "month") {
      const nextMonth = addMonths(currentDate, 1);
      setCurrentDate(nextMonth);
      setSelectedDate(startOfMonth(nextMonth));
      return;
    }

    const nextDate =
      view === "week" ? addWeeks(selectedDate, 1) : addDays(selectedDate, 1);
    setCurrentDate(nextDate);
    setSelectedDate(nextDate);
  }

  return (
    <div className="flex h-screen min-h-[720px] flex-col overflow-hidden bg-white pt-[58px]">
      <header className="fixed inset-x-0 top-0 z-50 flex h-[58px] items-center justify-between border-b border-[#e8e9ec] bg-white px-5">
        <div className="flex items-center gap-3">
          <span className="text-[15px] font-semibold tracking-[-0.02em] text-[#202124]">
            Ember
          </span>
          <span className="h-5 w-px bg-[#d9dce2]" />
          <span className="text-[12px] font-medium uppercase tracking-[0.04em] text-[#667085]">
            {format(today, "EEE d MMM yyyy")}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => openCreateDialog(selectedDate)}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-[#dfe2e7] bg-white px-3.5 text-[13px] font-medium text-[#25272b] transition-colors hover:bg-[#f7f7f8]"
          >
            <Plus className="h-3.5 w-3.5" />
            Add event
          </button>
          <button
            type="button"
            className="h-9 rounded-lg bg-[#17181a] px-3.5 text-[13px] font-medium text-white transition-colors hover:bg-black"
          >
            New habit
          </button>
          <button
            type="button"
            aria-label="Open Amira's profile"
            className="ml-1 flex h-8 w-8 items-center justify-center rounded-full bg-[#f59e0b] text-[11px] font-semibold text-white"
          >
            AM
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex h-[60px] shrink-0 items-center justify-between border-b border-[#eef0f3] px-5">
            <div className="flex items-baseline gap-3">
              <h1 className="text-[20px] font-semibold tracking-[-0.025em] text-[#202124]">
                {calendarTitle}
              </h1>
              <span className="text-[11px] font-medium uppercase text-[#98a2b3]">
                {visibleOccurrences.length} events · {visibleTasks.length} tasks
                · {visibleCompletions}/{visibleHabitOpportunities} kept
              </span>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex h-9 overflow-hidden rounded-lg border border-[#dfe2e7] bg-white">
                {(["month", "week", "day"] as const).map((option) => (
                  <button
                    type="button"
                    key={option}
                    aria-pressed={view === option}
                    onClick={() => {
                      setView(option);
                      setCurrentDate(selectedDate);
                    }}
                    className={cn(
                      "px-3.5 text-[13px] font-medium capitalize text-[#667085] transition-colors hover:text-[#202124]",
                      view === option && "bg-[#f1f2f4] text-[#202124]",
                    )}
                  >
                    {option}
                  </button>
                ))}
              </div>
              <button
                type="button"
                aria-label={`Previous ${view}`}
                onClick={goToPreviousPeriod}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#dfe2e7] text-[#667085] transition-colors hover:bg-[#f7f7f8] hover:text-[#202124]"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label={`Next ${view}`}
                onClick={goToNextPeriod}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#dfe2e7] text-[#667085] transition-colors hover:bg-[#f7f7f8] hover:text-[#202124]"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div
            className="grid h-8 shrink-0 border-b border-[#eef0f3]"
            style={{
              gridTemplateColumns: `repeat(${
                view === "day" ? 1 : 7
              }, minmax(0, 1fr))`,
            }}
          >
            {(view === "day"
              ? [format(selectedDate, "EEE")]
              : WEEKDAYS[preferences.weekStartsOn]
            ).map((weekday) => (
              <div
                key={weekday}
                className="flex items-center justify-center text-[10px] font-semibold uppercase tracking-[0.06em] text-[#8a94a6]"
              >
                {weekday}
              </div>
            ))}
          </div>

          <div
            className="grid min-h-0 flex-1"
            style={{
              gridTemplateColumns: `repeat(${
                view === "day" ? 1 : 7
              }, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${
                view === "month" ? 6 : 1
              }, minmax(0, 1fr))`,
            }}
          >
            {eventsLoading || completionsLoading
              ? Array.from({ length: 42 }).map((_, index) => (
                  <div
                    key={index}
                    className="border-b border-r border-[#eef0f3] p-2"
                  >
                    <Skeleton className="h-4 w-4 rounded-full" />
                  </div>
                ))
              : calendarDays.map((day) => {
                  const inMonth = isSameMonth(day, currentDate);
                  const selected = isSameDay(day, selectedDate);
                  const dayOccurrences = expandedOccurrences.filter((occ) =>
                    isSameDay(occ.occurrenceStart, day),
                  );
                  const dayTasks = tasksDueOn(tasks, day);
                  const dayItemCount = dayOccurrences.length + dayTasks.length;
                  const dayKey = format(day, "yyyy-MM-dd");
                  const completedHabitIds = new Set(
                    habitCompletions
                      .filter(
                        (completion) =>
                          completionDateKey(completion) === dayKey,
                      )
                      .map((completion) => completion.habitId),
                  );
                  const progressDone = completedHabitIds.size;
                  const showHabitProgress = view !== "month" || inMonth;
                  const eventLimit =
                    view === "month" ? 2 : view === "week" ? 6 : 12;

                  return (
                    <div
                      role="button"
                      tabIndex={0}
                      key={format(day, "yyyy-MM-dd")}
                      aria-label={`${format(day, "EEEE, d MMMM yyyy")}${
                        inMonth && habitsTotal > 0
                          ? `, ${progressDone} of ${habitsTotal} habits completed`
                          : ""
                      }. Double-click to add an event.`}
                      aria-pressed={selected}
                      onClick={() => setSelectedDate(day)}
                      onDoubleClick={() => openCreateDialog(day)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelectedDate(day);
                        }
                      }}
                      className={cn(
                        "group relative min-h-0 cursor-pointer overflow-hidden border-b border-r border-[#eef0f3] bg-white p-2 pb-8 text-left outline-none transition-colors hover:bg-[#fafafa] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[#202124]/30",
                        view !== "month" && "p-3 pb-10",
                        view === "month" && !inMonth && "bg-[#fcfcfd]",
                        selected && showHabitProgress && "bg-[#fdfdfd]",
                      )}
                    >
                      <button
                        type="button"
                        aria-label={`Add event on ${format(day, "EEEE, d MMMM yyyy")}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          openCreateDialog(day);
                        }}
                        onDoubleClick={(e) => e.stopPropagation()}
                        className="absolute right-1.5 top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-md border border-[#e3e5e9] bg-white text-[#98a2b3] opacity-0 shadow-sm transition-all hover:border-[#c9cdd4] hover:text-[#202124] focus-visible:opacity-100 group-hover:opacity-100"
                      >
                        <Plus className="h-3 w-3" />
                      </button>

                      <div className="space-y-1">
                        {dayOccurrences.slice(0, eventLimit).map((occurrence) => {
                          const event = occurrence.event;
                          const palette = eventPalette(event);
                          const chipTags = parseTags(event.tags);
                          return (
                            <button
                              type="button"
                              key={`${event.id}-${occurrence.occurrenceStart.toISOString()}`}
                              title={`${event.title}${
                                chipTags.length > 0
                                  ? ` · ${chipTags.map((tag) => `#${tag}`).join(" ")}`
                                  : ""
                              }`}
                              onClick={(e) => {
                                e.stopPropagation();
                                openEditDialog(event);
                              }}
                              onDoubleClick={(e) => e.stopPropagation()}
                              className={cn(
                                "block w-full rounded-[3px] px-1.5 py-[2px] text-left text-[10px] leading-[13px] transition-opacity hover:opacity-75",
                                palette.chip,
                                view !== "month" &&
                                  "rounded-md px-2.5 py-2 text-[12px] leading-4",
                              )}
                            >
                              <span className="block truncate">
                                {occurrence.isRecurring && (
                                  <Repeat className="mr-0.5 inline h-2.5 w-2.5 opacity-60" />
                                )}
                                {event.title}
                                {!event.isAllDay && (
                                  <span className="opacity-70">
                                    {" "}
                                    · {format(occurrence.occurrenceStart, "HH:mm")}
                                  </span>
                                )}
                              </span>
                              {view !== "month" && chipTags.length > 0 && (
                                <span className="mt-1 flex flex-wrap gap-1">
                                  {chipTags.slice(0, 3).map((tag) => (
                                    <span
                                      key={tag}
                                      className="rounded bg-white/60 px-1 py-px text-[9px] font-medium opacity-90"
                                    >
                                      #{tag}
                                    </span>
                                  ))}
                                </span>
                              )}
                            </button>
                          );
                        })}
                        {dayTasks
                          .slice(0, Math.max(0, eventLimit - dayOccurrences.length))
                          .map((task) => {
                            const done = isTaskComplete(task);
                            return (
                              <button
                                type="button"
                                key={`task-${task.id}`}
                                title={`${task.title} · ${completedItemCount(task)}/${task.items.length} done`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedDate(day);
                                }}
                                onDoubleClick={(e) => e.stopPropagation()}
                                className={cn(
                                  "block w-full rounded-[3px] px-1.5 py-[2px] text-left text-[10px] leading-[13px] transition-opacity hover:opacity-75",
                                  taskPalette.chip,
                                  view !== "month" &&
                                    "rounded-md px-2.5 py-2 text-[12px] leading-4",
                                )}
                              >
                                <span
                                  className={cn(
                                    "block truncate",
                                    done && "line-through opacity-70",
                                  )}
                                >
                                  <Check className="mr-0.5 inline h-2.5 w-2.5 opacity-60" />
                                  {task.title}
                                  <span className="opacity-70">
                                    {" "}
                                    · {format(new Date(task.dueAt as string), "HH:mm")}
                                  </span>
                                </span>
                              </button>
                            );
                          })}
                        {dayItemCount > eventLimit && (
                          <span className="block px-1 text-[9px] text-[#98a2b3]">
                            +{dayItemCount - eventLimit} more
                          </span>
                        )}
                      </div>

                      <div className="absolute inset-x-2 bottom-1.5 flex items-center gap-2">
                        <span
                          className={cn(
                            "flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1 text-[11px] font-medium text-[#202124]",
                            view === "month" && !inMonth && "text-[#c7ccd4]",
                            selected &&
                              showHabitProgress &&
                              "bg-[#202124] text-white",
                            view === "day" && "h-7 min-w-7 text-[14px]",
                          )}
                        >
                          {day.getDate()}
                        </span>

                        {showHabitProgress && habitsTotal > 0 && (
                          <>
                            <div
                              className="grid flex-1 gap-[2px]"
                              aria-label={`${progressDone} of ${habitsTotal} habits completed`}
                              style={{
                                gridTemplateColumns: `repeat(${habitsTotal}, minmax(0, 1fr))`,
                              }}
                            >
                              {habits?.map((habit) => {
                                const completed = completedHabitIds.has(
                                  habit.id,
                                );
                                return (
                                  <span
                                    key={habit.id}
                                    title={`${habit.name}: ${
                                      completed ? "completed" : "not completed"
                                    }`}
                                    className={cn(
                                      "h-[2px] rounded-full bg-[#e6e9ee]",
                                      view !== "month" && "h-1",
                                      completed && "bg-[#647087]",
                                    )}
                                  />
                                );
                              })}
                            </div>
                            <span className="shrink-0 text-[9px] font-medium text-[#98a2b3]">
                              {progressDone}/{habitsTotal}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
          </div>
        </section>

        {rightPanelOpen ? (
          <aside className="hidden w-[298px] shrink-0 border-l border-[#e5e7eb] bg-white lg:flex lg:flex-col">
            <div className="flex h-8 shrink-0 items-center justify-center border-b border-[#eef0f3]">
              <button
                type="button"
                aria-label="Collapse details panel"
                onClick={() => setRightPanelOpen(false)}
                className="flex h-6 w-6 items-center justify-center rounded text-[#98a2b3] hover:bg-[#f4f4f5] hover:text-[#202124]"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <div className="overflow-y-auto px-4 py-4">
              <div className="mb-6">
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-[12px] font-semibold text-[#202124]">
                    {isSameDay(selectedDate, today)
                      ? "Today's schedule"
                      : `Schedule · ${format(selectedDate, "d MMM")}`}
                  </h2>
                  <button
                    type="button"
                    onClick={() => openCreateDialog(selectedDate)}
                    className="flex h-6 items-center gap-1 rounded px-1.5 text-[11px] font-medium text-[#667085] transition-colors hover:bg-[#f1f2f4] hover:text-[#202124]"
                  >
                    <Plus className="h-3 w-3" />
                    Add
                  </button>
                </div>

                {selectedDayIsEmpty ? (
                  <p className="rounded-md border border-dashed border-[#e3e5e9] px-3 py-3 text-[10px] leading-4 text-[#98a2b3]">
                    Nothing scheduled. Click a day, then add an event — or
                    double-click any date on the grid.
                  </p>
                ) : (
                  <div className="space-y-1">
                    {selectedDayOccurrences.map((occurrence) => {
                      const event = occurrence.event;
                      const palette = eventPalette(event);
                      const chipTags = parseTags(event.tags);
                      const eventExercises = event.exercises ?? [];
                      return (
                        <button
                          type="button"
                          key={`${event.id}-${occurrence.occurrenceStart.toISOString()}`}
                          onClick={() => openEditDialog(event)}
                          className="group/event flex w-full items-start gap-2 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-[#f7f7f8]"
                        >
                          <span className="w-9 shrink-0 pt-px text-right text-[10px] font-medium tabular-nums text-[#98a2b3]">
                            {event.isAllDay
                              ? "all"
                              : format(occurrence.occurrenceStart, "HH:mm")}
                          </span>
                          <span
                            className={cn(
                              "mt-1 h-2 w-2 shrink-0 rounded-full",
                              palette.dot,
                            )}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[11px] font-medium leading-4 text-[#30333a]">
                              {occurrence.isRecurring && (
                                <Repeat className="mr-0.5 inline h-2.5 w-2.5 opacity-60" />
                              )}
                              {event.title}
                            </span>
                            <span className="mt-0.5 flex flex-wrap items-center gap-1">
                              <span className="text-[9px] uppercase tracking-wide text-[#98a2b3]">
                                {event.category}
                              </span>
                              {chipTags.slice(0, 3).map((tag) => (
                                <span
                                  key={tag}
                                  className="rounded bg-[#f1f2f4] px-1 py-px text-[9px] font-medium text-[#667085]"
                                >
                                  #{tag}
                                </span>
                              ))}
                              {eventExercises.length > 0 && (
                                <span className="flex items-center gap-0.5 rounded bg-[#f0faf0] px-1 py-px text-[9px] font-medium text-[#4a7a4a]">
                                  <Dumbbell className="h-2 w-2" />
                                  {eventExercises.length} exercise{eventExercises.length !== 1 ? "s" : ""}
                                </span>
                              )}
                            </span>
                            {event.link && (
                              <a
                                href={event.link}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="mt-1 flex items-center gap-1 text-[9px] text-[#667085] transition-colors hover:text-[#202124]"
                              >
                                <Link2 className="h-2.5 w-2.5" />
                                <span className="truncate">{event.link.replace(/^https?:\/\//, "")}</span>
                              </a>
                            )}
                          </span>
                        </button>
                      );
                    })}

                    {selectedDayTasks.map((task) => {
                      const done = isTaskComplete(task);
                      const doneCount = completedItemCount(task);
                      return (
                        <div
                          key={`task-${task.id}`}
                          className="rounded-md px-1.5 py-1.5"
                        >
                          <div className="flex items-start gap-2">
                            <span className="w-9 shrink-0 pt-px text-right text-[10px] font-medium tabular-nums text-[#98a2b3]">
                              {format(new Date(task.dueAt as string), "HH:mm")}
                            </span>
                            <span
                              className={cn(
                                "mt-1 h-2 w-2 shrink-0 rounded-full",
                                taskPalette.dot,
                              )}
                            />
                            <span className="min-w-0 flex-1">
                              <span
                                className={cn(
                                  "block truncate text-[11px] font-medium leading-4 text-[#30333a]",
                                  done &&
                                    "text-[#9299a5] line-through decoration-[#b9bec7]",
                                )}
                              >
                                {task.title}
                              </span>
                              <span className="mt-0.5 block text-[9px] uppercase tracking-wide text-[#98a2b3]">
                                task · {doneCount}/{task.items.length} done
                              </span>
                            </span>
                          </div>
                          <div className="mt-1 space-y-1 pl-[46px]">
                            {task.items.map((item) => (
                              <button
                                type="button"
                                key={item.id}
                                disabled={toggleTaskItemMutation.isPending}
                                onClick={() =>
                                  toggleTaskItemMutation.mutate({
                                    taskId: task.id,
                                    itemId: item.id,
                                  })
                                }
                                aria-pressed={item.completed}
                                className="group flex w-full items-start gap-2 text-left disabled:cursor-wait disabled:opacity-60"
                              >
                                <span
                                  className={cn(
                                    "mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border border-[#cfd4dc] bg-white text-white",
                                    item.completed &&
                                      "border-[#202124] bg-[#202124]",
                                  )}
                                >
                                  {item.completed && (
                                    <Check className="h-2 w-2" />
                                  )}
                                </span>
                                <span
                                  className={cn(
                                    "min-w-0 flex-1 truncate text-[10px] leading-4 text-[#5c636e]",
                                    item.completed &&
                                      "text-[#9299a5] line-through decoration-[#b9bec7]",
                                  )}
                                >
                                  {item.label}
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="mb-6">
                <div className="mb-1 flex items-center justify-between">
                  <h2 className="text-[12px] font-semibold text-[#202124]">
                    {isSameDay(selectedDate, today)
                      ? "Today's habits"
                      : `Habits · ${format(selectedDate, "d MMM")}`}
                  </h2>
                  <span className="text-[11px] font-medium text-[#98a2b3]">
                    {habitsDone}/{habitsTotal}
                  </span>
                </div>
                <p className="mb-3 text-[10px] text-[#98a2b3]">
                  {habitsTotal === 0
                    ? "Add a habit to begin tracking your day."
                    : habitsDone === habitsTotal
                      ? "All done — excellent consistency."
                      : `${habitsDone} down — ${habitsTotal - habitsDone} small ${
                          habitsTotal - habitsDone === 1 ? "one" : "ones"
                        } left. Nice pace.`}
                </p>

                {habitsLoading || completionsLoading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 4 }).map((_, index) => (
                      <Skeleton key={index} className="h-8 w-full rounded" />
                    ))}
                  </div>
                ) : habits && habits.length > 0 ? (
                  <div className="space-y-2">
                    {habits.map((habit) => {
                      const done = selectedCompletedHabitIds.has(habit.id);
                      return (
                        <button
                          type="button"
                          key={habit.id}
                          disabled={completeMutation.isPending}
                          onClick={() => toggleHabit(habit)}
                          className="group flex w-full items-start gap-2 text-left disabled:cursor-wait disabled:opacity-60"
                        >
                          <span
                            className={cn(
                              "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border border-[#cfd4dc] bg-white text-white",
                              done && "border-[#202124] bg-[#202124]",
                            )}
                          >
                            {done && <Check className="h-2.5 w-2.5" />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span
                              className={cn(
                                "block truncate text-[11px] font-medium leading-4 text-[#30333a]",
                                done &&
                                  "text-[#9299a5] line-through decoration-[#b9bec7]",
                              )}
                            >
                              {habit.name}
                            </span>
                            {(habit.description || habit.targetMetric) && (
                              <span className="block truncate text-[9px] leading-3 text-[#98a2b3]">
                                {habit.description || habit.targetMetric}
                              </span>
                            )}
                          </span>
                          {habit.streakCount > 0 && (
                            <span className="flex shrink-0 items-center gap-0.5 text-[9px] font-semibold text-[#e87900]">
                              <Flame className="h-2.5 w-2.5 fill-[#f59e0b] stroke-[#f59e0b]" />
                              {habit.streakCount}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-[11px] text-[#98a2b3]">
                    No habits configured yet.
                  </p>
                )}
              </div>

              <div>
                <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#98a2b3]">
                  Streaks
                </h2>
                {streaks ? (
                  <div className="space-y-2">
                    {/* Active indicator */}
                    {streaks.currentWeekActive && (
                      <div className="flex items-center gap-1.5 rounded-md bg-[#f0faf0] px-2.5 py-1.5">
                        <Zap className="h-3 w-3 fill-[#22c55e] stroke-[#22c55e]" />
                        <span className="text-[10px] font-medium text-[#166534]">
                          Active this week
                        </span>
                      </div>
                    )}

                    {/* Workout streak */}
                    <div className="flex items-center gap-2 rounded-md border border-[#eef0f3] px-2.5 py-2">
                      <Flame className="h-4 w-4 shrink-0 fill-[#f59e0b] stroke-[#f59e0b]" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] font-bold leading-tight text-[#202124]">
                          {streaks.workoutStreak}
                          <span className="ml-1 text-[11px] font-medium text-[#667085]">
                            week{streaks.workoutStreak !== 1 ? "s" : ""}
                          </span>
                        </p>
                        <p className="text-[10px] text-[#98a2b3]">Workout streak</p>
                      </div>
                    </div>

                    {/* Meeting streak */}
                    <div className="flex items-center gap-2 rounded-md border border-[#eef0f3] px-2.5 py-2">
                      <Users className="h-4 w-4 shrink-0 text-[#4472ca]" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] font-bold leading-tight text-[#202124]">
                          {streaks.meetingStreak}
                          <span className="ml-1 text-[11px] font-medium text-[#667085]">
                            week{streaks.meetingStreak !== 1 ? "s" : ""}
                          </span>
                        </p>
                        <p className="text-[10px] text-[#98a2b3]">Meeting streak</p>
                      </div>
                    </div>

                    {/* Habit streaks */}
                    {streaks.habitStreaks.length > 0 && (
                      <div className="rounded-md border border-[#eef0f3] px-2.5 py-2">
                        <div className="mb-1.5 flex items-center gap-1.5">
                          <Trophy className="h-3.5 w-3.5 text-[#e87900]" />
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#667085]">
                            Habits
                          </p>
                        </div>
                        <div className="space-y-1">
                          {streaks.habitStreaks
                            .filter((h) => h.streakCount > 0)
                            .sort((a, b) => b.streakCount - a.streakCount)
                            .slice(0, 5)
                            .map((habit) => (
                              <div
                                key={habit.habitId}
                                className="flex items-center justify-between"
                              >
                                <span className="truncate text-[11px] text-[#596273]">
                                  {habit.habitName}
                                </span>
                                <span className="flex shrink-0 items-center gap-0.5 text-[10px] font-semibold text-[#e87900]">
                                  <Flame className="h-2.5 w-2.5 fill-[#f59e0b] stroke-[#f59e0b]" />
                                  {habit.streakCount}
                                </span>
                              </div>
                            ))}
                          {streaks.habitStreaks.filter(
                            (h) => h.streakCount > 0,
                          ).length === 0 && (
                            <p className="text-[10px] text-[#98a2b3]">
                              No active habit streaks yet.
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="h-12 w-full rounded-md" />
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-6">
                <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#98a2b3]">
                  Reminders
                </h2>
                {activeReminders.length > 0 ? (
                  <div className="space-y-2">
                    {activeReminders.map((reminder) => (
                      <div
                        key={reminder.id}
                        className="flex items-center justify-between gap-3 text-[11px]"
                      >
                        <span className="truncate text-[#596273]">
                          {reminder.name}
                        </span>
                        <span className="flex shrink-0 items-center gap-1 text-[#98a2b3]">
                          {reminder.scheduleType === "interval" ? (
                            <>
                              <Timer className="h-2.5 w-2.5" />
                              every {reminder.intervalMinutes} min
                            </>
                          ) : (
                            <>
                              <Clock className="h-2.5 w-2.5" />
                              {reminder.timeOfDay}
                            </>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-[#98a2b3]">
                    No active reminders.
                  </p>
                )}
              </div>
            </div>
          </aside>
        ) : (
          <button
            type="button"
            aria-label="Expand details panel"
            onClick={() => setRightPanelOpen(true)}
            className="hidden w-8 shrink-0 items-start justify-center border-l border-[#e5e7eb] pt-2 text-[#98a2b3] hover:bg-[#fafafa] hover:text-[#202124] lg:flex"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}
      </div>

      <EventDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        event={editingEvent}
        defaultDate={dialogDate}
        tagSuggestions={allTags}
        onSubmit={handleEventSubmit}
        onDelete={(id) => deleteEventMutation.mutate(id)}
        isSaving={createEventMutation.isPending || updateEventMutation.isPending}
      />
    </div>
  );
}
