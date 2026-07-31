import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { addDays, format, startOfWeek, startOfDay, endOfDay, isSameDay } from "date-fns";
import { Plus, ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "@/lib/api";
import { queryKeys, type Event } from "@/lib/query-keys";
import { expandEvents } from "@/lib/recurrence";
import { LiveTimeline } from "@/components/mobile/live-timeline";
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
    staleTime: 60_000,
  });

  const weekOccurrences = useMemo(
    () => expandEvents(events ?? [], weekStart, weekEnd),
    [events, weekStart.getTime(), weekEnd.getTime()],
  );

  const dayOccurrences = useMemo(
    () =>
      weekOccurrences.filter((occurrence) =>
        isSameDay(occurrence.occurrenceStart, selected),
      ),
    [weekOccurrences, selected.getTime()],
  );

  return (
    <div className="flex flex-col gap-4">
      <header className="m-anim-slide-up flex items-center justify-between">
        <div>
          <p className="m-eyebrow">{format(selected, "MMMM yyyy")}</p>
          <h1 className="mt-1 text-[28px] font-semibold tracking-tight text-[var(--m-text)]">
            Calendar
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
        className="m-card m-anim-slide-up p-2.5"
        style={{ animationDelay: "40ms" }}
        aria-label={`Week of ${format(weekDays[0], "MMMM d")}`}
      >
        <div className="mb-2 flex items-center justify-between">
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
            className="m-press min-h-11 rounded-lg px-4 text-[11px] font-semibold uppercase tracking-wider text-[var(--m-text-2)]"
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

        <div className="grid grid-cols-7 gap-0.5">
          {weekDays.map((day) => {
            const active = isSameDay(day, selected);
            const isToday = isSameDay(day, now);
            const hasEvents = weekOccurrences.some((occurrence) =>
              isSameDay(occurrence.occurrenceStart, day),
            );
            return (
              <button
                key={day.toISOString()}
                type="button"
                onClick={() => setSelected(day)}
                aria-label={format(day, "EEEE, MMMM d")}
                aria-pressed={active}
                className={cn(
                  "m-press flex min-h-[66px] min-w-0 flex-col items-center justify-center gap-1 rounded-xl border",
                  active
                    ? "border-[var(--m-text)] bg-[var(--m-primary)] text-[var(--m-primary-fg)]"
                    : "border-transparent",
                )}
              >
                <span className={cn("text-[8px] font-semibold uppercase", active ? "text-white/60" : "text-[var(--m-text-3)]")}>
                  {format(day, "EEEEE")}
                </span>
                <span className={cn("text-[14px] font-semibold tabular-nums", active ? "text-white" : "text-[var(--m-text-2)]")}>
                  {format(day, "d")}
                </span>
                <span
                  className={cn(
                    "h-1 w-1 rounded-full",
                    hasEvents
                      ? active
                        ? "bg-white"
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

      <section className="m-anim-slide-up" style={{ animationDelay: "80ms" }}>
        <div className="mb-2 flex items-center justify-between">
          <div>
            <h2 className="text-[15px] font-semibold text-[var(--m-text)]">
              {isSameDay(selected, now)
                ? "Today’s plan"
                : format(selected, "EEEE")}
            </h2>
            <p className="text-[11px] text-[var(--m-text-3)]">
              {dayOccurrences.length === 0
                ? "Nothing scheduled"
                : `${dayOccurrences.length} ${dayOccurrences.length === 1 ? "item" : "items"}`}
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              openQuickCapture({
                kind: "event",
                date: format(selected, "yyyy-MM-dd"),
              })
            }
            className="m-secondary-button m-press min-h-11 px-3 text-[12px]"
          >
            Add
          </button>
        </div>
        {isLoading ? (
          <div className="space-y-2" aria-label="Loading calendar">
            <div className="m-skeleton h-16 rounded-xl" />
            <div className="m-skeleton h-16 rounded-xl" />
          </div>
        ) : (
          <LiveTimeline
            occurrences={dayOccurrences}
            now={now}
            emptyLabel="A clear day"
            onAdd={() =>
              openQuickCapture({
                kind: "event",
                date: format(selected, "yyyy-MM-dd"),
              })
            }
          />
        )}
      </section>
    </div>
  );
}
