import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { format, startOfDay, endOfDay } from "date-fns";
import {
  Activity,
  CalendarDays,
  CheckSquare2,
  ChevronRight,
  Flame as FlameIcon,
  Plus,
  Settings,
} from "lucide-react";
import { api } from "@/lib/api";
import { queryKeys, type Event, type Habit, type HabitCompletion, type StreaksData } from "@/lib/query-keys";
import { expandEvents } from "@/lib/recurrence";
import { ProgressRing } from "@/components/mobile/progress-ring";
import { LiveTimeline } from "@/components/mobile/live-timeline";
import { StreakFlame } from "@/components/mobile/streak-flame";
import { MobileErrorState } from "@/components/mobile/error-state";
import {
  openQuickCapture,
  type CaptureKind,
} from "@/components/mobile/quick-action-sheet";

export const Route = createFileRoute("/m/")({
  component: MobileHome,
});

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
  const now = useNow();
  const dayStart = startOfDay(now);
  const dayEnd = endOfDay(now);
  const fromStr = format(dayStart, "yyyy-MM-dd");
  const toStr = format(dayEnd, "yyyy-MM-dd");

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
    staleTime: 60_000,
  });

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

  const habitsDone = completionQueries.filter((q) => (q.data ?? []).length > 0).length;
  const habitsTotal = habits?.length ?? 0;
  const eventsDone = occurrences.filter((o) => o.occurrenceEnd.getTime() < now.getTime()).length;
  const eventsTotal = occurrences.length;
  const totalItems = habitsTotal + eventsTotal;
  const doneItems = habitsDone + eventsDone;
  const progress = totalItems > 0 ? doneItems / totalItems : 0;
  const dataLoading = eventsLoading || habitsLoading;

  const bestHabitStreak = useMemo(
    () => (streaks?.habitStreaks ?? []).reduce((max, h) => Math.max(max, h.streakCount), 0),
    [streaks],
  );

  const hour = now.getHours();
  const greeting = hour < 5 ? "Night owl mode" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="flex flex-col gap-6">
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
        <button
          type="button"
          onClick={() => void navigate({ to: "/m/settings" })}
          className="m-icon-button m-press"
          aria-label="Open settings"
        >
          <Settings width={18} height={18} />
        </button>
      </header>

      <section
        className="m-anim-slide-up"
        style={{ animationDelay: "35ms" }}
        aria-labelledby="mobile-hero-title"
      >
        <p className="text-[15px] font-medium italic text-[var(--m-text-2)]">
          {greeting}
        </p>
        <h1
          id="mobile-hero-title"
          className="mt-1 max-w-[340px] text-[38px] font-medium leading-[1.03] tracking-[-0.045em] text-[var(--m-text)]"
        >
          Your day.{" "}
          <span className="text-[var(--m-text-2)] underline decoration-[1.5px] underline-offset-[6px]">
            Under control.
          </span>
        </h1>

        <button
          type="button"
          onClick={() => openQuickCapture()}
          className="m-press mt-6 flex min-h-16 w-full items-center gap-3 rounded-[20px] border border-[var(--m-border)] bg-white px-4 text-left shadow-[0_8px_28px_rgba(0,0,0,0.07)]"
          aria-haspopup="dialog"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--m-surface-2)] text-[var(--m-text-2)]">
            <Plus width={18} height={18} strokeWidth={2.25} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-semibold text-[var(--m-text)]">
              Add something
            </span>
            <span className="block truncate text-[12px] text-[var(--m-text-3)]">
              Activity, task, or event
            </span>
          </span>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--m-primary)] text-[var(--m-primary-fg)]">
            <ChevronRight width={18} height={18} />
          </span>
        </button>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <QuickButton
            kind="activity"
            icon={Activity}
            label="Activity"
            sublabel="Block time"
          />
          <QuickButton
            kind="task"
            icon={CheckSquare2}
            label="Task"
            sublabel="Set deadline"
          />
          <QuickButton
            kind="event"
            icon={CalendarDays}
            label="Event"
            sublabel="Schedule"
            emphasized
          />
        </div>
      </section>

      {(eventsError || habitsError) && (
        <MobileErrorState
          title="Your day is out of reach"
          message="We couldn’t refresh your calendar data."
          onRetry={() => {
            void Promise.all([refetchEvents(), refetchHabits()]);
          }}
        />
      )}

      <section
        className="m-card m-anim-slide-up p-4"
        style={{ animationDelay: "70ms" }}
        aria-labelledby="today-progress-title"
      >
        <div className="flex items-center gap-4">
          <ProgressRing progress={progress} size={82} strokeWidth={7}>
            <span className="text-lg font-semibold tabular-nums leading-none">
              {dataLoading || totalItems === 0
                ? "—"
                : `${Math.round(progress * 100)}%`}
            </span>
            <span className="mt-1 text-[9px] font-semibold uppercase tracking-wider text-[var(--m-text-3)]">
              today
            </span>
          </ProgressRing>

          <div className="min-w-0 flex-1">
            <div className="mb-2.5 flex items-center justify-between gap-2">
              <div>
                <h2
                  id="today-progress-title"
                  className="text-[14px] font-semibold text-[var(--m-text)]"
                >
                  Today at a glance
                </h2>
                <p className="text-[11px] text-[var(--m-text-3)]">
                  {dataLoading
                    ? "Refreshing your day…"
                    : totalItems === 0
                    ? "A fresh slate."
                    : `${doneItems} of ${totalItems} items complete`}
                </p>
              </div>
              <StreakFlame streak={bestHabitStreak} size="sm" />
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <MiniStat
                label="Habits"
                value={habitsLoading ? "—" : `${habitsDone}/${habitsTotal}`}
              />
              <MiniStat
                label="Events"
                value={eventsLoading ? "—" : `${eventsDone}/${eventsTotal}`}
              />
              <MiniStat label="Streak" value={`${streaks?.workoutStreak ?? 0}w`} />
            </div>
          </div>
        </div>
      </section>

      <section className="m-anim-slide-up" style={{ animationDelay: "105ms" }}>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="m-eyebrow">Coming up</h2>
          <button
            onClick={() => void navigate({ to: "/m/calendar" })}
            className="m-press flex min-h-11 items-center gap-0.5 rounded-lg px-2 text-[12px] font-medium text-[var(--m-text-2)]"
          >
            Calendar <ChevronRight width={12} height={12} />
          </button>
        </div>
        {eventsLoading ? (
          <div className="space-y-2" aria-label="Loading upcoming events">
            <div className="m-skeleton h-16 w-full rounded-xl" />
            <div className="m-skeleton h-16 w-full rounded-xl" />
          </div>
        ) : (
          <LiveTimeline
            occurrences={occurrences}
            now={now}
            onAdd={() => openQuickCapture({ kind: "event" })}
          />
        )}
      </section>
    </div>
  );
}

function QuickButton({
  kind,
  icon: Icon,
  label,
  sublabel,
  emphasized = false,
}: {
  kind: CaptureKind;
  icon: React.ComponentType<{ width?: number; height?: number; strokeWidth?: number; className?: string }>;
  label: string;
  sublabel: string;
  emphasized?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => openQuickCapture({ kind })}
      className={`m-press flex min-h-[94px] min-w-0 flex-col items-start justify-between rounded-[18px] border p-3 text-left ${
        emphasized
          ? "border-[var(--m-primary)] bg-[var(--m-primary)] text-[var(--m-primary-fg)]"
          : "border-[var(--m-border)] bg-white text-[var(--m-text)]"
      }`}
      aria-haspopup="dialog"
    >
      <Icon width={18} height={18} strokeWidth={2} />
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-semibold">{label}</span>
        <span
          className={`block truncate text-[10px] ${
            emphasized ? "text-white/60" : "text-[var(--m-text-3)]"
          }`}
        >
          {sublabel}
        </span>
      </span>
    </button>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-[var(--m-surface-2)] px-2 py-2">
      <span className="block truncate text-[9px] font-medium text-[var(--m-text-3)]">
        {label}
      </span>
      <span className="mt-0.5 block text-[12px] font-semibold tabular-nums text-[var(--m-text)]">
        {value}
      </span>
    </div>
  );
}
