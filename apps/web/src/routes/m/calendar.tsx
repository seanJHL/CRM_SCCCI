import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { addDays, format, startOfWeek, startOfDay, endOfDay, isSameDay } from "date-fns";
import {
  CalendarDays,
  Check,
  Circle,
  Plus,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { api } from "@/lib/api";
import { queryKeys, type Event } from "@/lib/query-keys";
import { expandEvents, isOccurrenceComplete } from "@/lib/recurrence";
import {
  eventPalette,
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

  const toggleCompletionMutation = useMutation({
    mutationFn: ({ eventId, occurrenceStart }: { eventId: string; occurrenceStart: string }) =>
      api.post(`/api/events/${eventId}/completions/toggle`, {
        occurrenceStart,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.events.all });
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
            const hasEvents = weekOccurrences.some(
              (occurrence) =>
                occurrence.occurrenceStart.getTime() <= endOfDay(day).getTime() &&
                occurrence.occurrenceEnd.getTime() >= startOfDay(day).getTime(),
            );
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
                    hasEvents
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
            {dayOccurrences.length === 0
              ? "Open"
              : `${dayOccurrences.length} ${dayOccurrences.length === 1 ? "item" : "items"}`}
          </span>
        </div>
        {isLoading ? (
          <div className="space-y-2" aria-label="Loading calendar">
            <div className="m-skeleton h-16 rounded-xl" />
            <div className="m-skeleton h-16 rounded-xl" />
          </div>
        ) : dayOccurrences.length === 0 ? (
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
          </div>
        )}
      </section>
    </div>
  );
}
