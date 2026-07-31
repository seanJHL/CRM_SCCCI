import { Link } from "lucide-react";
import { format, isBefore, isAfter } from "date-fns";
import { cn } from "@/lib/utils";
import type { EventOccurrence } from "@/lib/recurrence";

interface LiveTimelineProps {
  occurrences: EventOccurrence[];
  now: Date;
  emptyLabel?: string;
  onAdd?: () => void;
}

const CATEGORY_DOT: Record<string, string> = {
  meeting: "bg-[var(--m-text)]",
  shift: "bg-[var(--m-text-2)]",
  personal: "bg-[var(--m-text-3)]",
  deadline: "bg-[var(--m-ember-red)]",
};

/**
 * LiveTimeline — vertical rail of today's events with a "now" marker.
 * Clean monochrome styling.
 */
export function LiveTimeline({
  occurrences,
  now,
  emptyLabel = "Nothing scheduled",
  onAdd,
}: LiveTimelineProps) {
  if (occurrences.length === 0) {
    return (
      <div className="m-inset flex flex-col items-center justify-center px-4 py-7 text-center">
        <p className="text-[14px] font-semibold text-[var(--m-text)]">
          {emptyLabel}
        </p>
        <p className="mt-1 text-[12px] text-[var(--m-text-3)]">
          Enjoy the calm, or give the day a little shape.
        </p>
        {onAdd && (
          <button
            type="button"
            onClick={onAdd}
            className="m-secondary-button m-press mt-4 min-h-11 px-4 text-[12px]"
          >
            Add to this day
          </button>
        )}
      </div>
    );
  }

  const rows: React.ReactNode[] = [];
  let nowInserted = false;

  occurrences.forEach((occ, i) => {
    const start = occ.occurrenceStart;
    const end = occ.occurrenceEnd;
    const isPast = isBefore(end, now);
    const isLive = !isPast && isBefore(start, now);
    const isFuture = isAfter(start, now);

    if (!nowInserted && (isFuture || isLive)) {
      nowInserted = true;
      rows.push(
        <div key="now-marker" className="flex items-center gap-2 py-0.5">
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--m-text)] [animation:m-pulse-dot_1.6s_ease-in-out_infinite]" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--m-text)]" />
          </span>
          <span className="m-eyebrow">Now</span>
          <span className="h-px flex-1 bg-[var(--m-border)]" />
        </div>,
      );
    }

    rows.push(
      <div
        key={`${occ.event.id}-${start.toISOString()}`}
        className={cn("m-stagger flex items-stretch gap-3", isPast && "opacity-40")}
        style={{ ["--m-i" as string]: i + 1 }}
      >
        {/* Time gutter */}
        <div className="flex w-12 shrink-0 flex-col items-end pt-0.5">
          <span className={cn("text-[12px] font-medium tabular-nums", isLive ? "text-[var(--m-text)]" : "text-[var(--m-text-2)]")}>
            {occ.event.isAllDay ? "All day" : format(start, "h:mm")}
          </span>
          {!occ.event.isAllDay && (
            <span className="text-[10px] text-[var(--m-text-3)]">{format(start, "a")}</span>
          )}
        </div>

        {/* Rail */}
        <div className="flex flex-col items-center">
          <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", CATEGORY_DOT[occ.event.category] ?? "bg-[var(--m-text-3)]")} />
          {i < occurrences.length - 1 && <span className="mt-1 w-px flex-1 bg-[var(--m-border)]" />}
        </div>

        {/* Event card */}
        <div
          className={cn(
            "mb-2 flex-1 rounded-lg border px-3 py-2.5",
            isLive
              ? "border-[var(--m-text)] bg-[var(--m-surface-2)]"
              : "border-[var(--m-border)] bg-[var(--m-surface)]",
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <p className={cn("truncate text-[13px] font-medium", isPast && "line-through decoration-[var(--m-text-3)]")}>
              {occ.event.title}
            </p>
            {occ.event.link && (
              <a
                href={occ.event.link}
                target="_blank"
                rel="noreferrer"
                className="m-press shrink-0 rounded p-1 text-[var(--m-text-3)] hover:text-[var(--m-text)]"
                aria-label={`Open link for ${occ.event.title}`}
              >
                <Link width={12} height={12} />
              </a>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[var(--m-text-3)]">
            {!occ.event.isAllDay && (
              <span>
                {format(start, "h:mm")} – {format(end, "h:mm")}
              </span>
            )}
            {occ.isRecurring && <span className="rounded bg-[var(--m-surface-3)] px-1 py-px">Repeats</span>}
            {occ.event.isOptional && <span className="rounded bg-[var(--m-surface-3)] px-1 py-px">Optional</span>}
          </div>
        </div>
      </div>,
    );
  });

  if (!nowInserted) {
    rows.push(
      <div key="now-marker-end" className="flex items-center gap-2 pt-1">
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--m-text)] [animation:m-pulse-dot_1.6s_ease-in-out_infinite]" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--m-text)]" />
        </span>
        <span className="m-eyebrow">All caught up</span>
        <span className="h-px flex-1 bg-[var(--m-border)]" />
      </div>,
    );
  }

  return <div className="flex flex-col">{rows}</div>;
}
