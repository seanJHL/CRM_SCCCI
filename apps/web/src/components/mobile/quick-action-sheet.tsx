import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Activity,
  CalendarDays,
  CheckSquare2,
  ChevronDown,
  Clock3,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { notify } from "@/components/mobile/notification-banner";

export type CaptureKind = "activity" | "task" | "event";

export interface QuickCaptureRequest {
  kind?: CaptureKind;
  date?: string;
  title?: string;
}

export function openQuickCapture(request: QuickCaptureRequest = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<QuickCaptureRequest>("ember:quick-capture", {
      detail: request,
    }),
  );
}

interface QuickActionSheetProps {
  open: boolean;
  onClose: () => void;
  request?: QuickCaptureRequest;
}

const CAPTURE_TYPES = [
  {
    id: "activity",
    label: "Activity",
    description: "Block time",
    icon: Activity,
    category: "personal",
    duration: 30,
    placeholder: "e.g. Evening walk",
  },
  {
    id: "task",
    label: "Task",
    description: "Set a deadline",
    icon: CheckSquare2,
    category: "deadline",
    duration: 30,
    placeholder: "e.g. Send the proposal",
  },
  {
    id: "event",
    label: "Event",
    description: "Schedule it",
    icon: CalendarDays,
    category: "meeting",
    duration: 60,
    placeholder: "e.g. Project catch-up",
  },
] as const;

const DURATIONS = [15, 30, 45, 60, 90, 120] as const;

function defaultSchedule() {
  const date = new Date();
  const minutes = date.getMinutes();
  date.setMinutes(minutes < 30 ? 30 : 60, 0, 0);
  return {
    date: format(date, "yyyy-MM-dd"),
    time: format(date, "HH:mm"),
  };
}

export function QuickActionSheet({
  open,
  onClose,
  request,
}: QuickActionSheetProps) {
  const queryClient = useQueryClient();
  const titleRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<CaptureKind>("event");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(() => defaultSchedule().date);
  const [time, setTime] = useState(() => defaultSchedule().time);
  const [duration, setDuration] = useState(60);

  const activeType = useMemo(
    () => CAPTURE_TYPES.find((type) => type.id === kind) ?? CAPTURE_TYPES[2],
    [kind],
  );

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api.post("/api/events", payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.events.all });
      notify({
        title: `${activeType.label} added`,
        body: `${title.trim()} is on your calendar.`,
      });
      onClose();
    },
  });

  useEffect(() => {
    if (!open) return;
    const nextKind = request?.kind ?? "event";
    const nextType =
      CAPTURE_TYPES.find((type) => type.id === nextKind) ?? CAPTURE_TYPES[2];
    const nextSchedule = defaultSchedule();
    createMutation.reset();
    setKind(nextKind);
    setTitle(request?.title ?? "");
    setDate(request?.date ?? nextSchedule.date);
    setTime(nextSchedule.time);
    setDuration(nextType.duration);
  }, [open, request]);

  const selectKind = (nextKind: CaptureKind) => {
    createMutation.reset();
    const nextType =
      CAPTURE_TYPES.find((type) => type.id === nextKind) ?? CAPTURE_TYPES[2];
    setKind(nextKind);
    setDuration(nextType.duration);
  };

  const scheduleShortcut = (shortcut: "now" | "later" | "tomorrow") => {
    const next = new Date();
    if (shortcut === "later") {
      next.setHours(next.getHours() + 2, 0, 0, 0);
    } else if (shortcut === "tomorrow") {
      next.setDate(next.getDate() + 1);
      next.setHours(9, 0, 0, 0);
    } else {
      next.setMinutes(next.getMinutes() < 30 ? 30 : 60, 0, 0);
    }
    setDate(format(next, "yyyy-MM-dd"));
    setTime(format(next, "HH:mm"));
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || createMutation.isPending) return;

    const start = new Date(`${date}T${time}:00`);
    if (Number.isNaN(start.getTime())) return;
    const end = new Date(start.getTime() + duration * 60_000);

    createMutation.mutate({
      title: title.trim(),
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      category: activeType.category,
      tags: kind,
    });
  };

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="m-sheet-overlay fixed inset-0 z-50 bg-black/35 backdrop-blur-[2px]" />
        <DialogPrimitive.Content
          className="m-mobile-surface m-sheet-content fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[min(92dvh,760px)] w-full max-w-lg overflow-y-auto rounded-t-[28px] border border-b-0 border-[var(--m-border)] bg-[var(--m-surface)] px-4 pb-[calc(env(safe-area-inset-bottom,0px)+20px)] pt-3 shadow-[0_-18px_50px_rgba(0,0,0,0.16)] sm:bottom-4 sm:rounded-[28px] sm:border sm:pb-5"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            window.setTimeout(() => titleRef.current?.focus(), 80);
          }}
        >
          <div
            aria-hidden="true"
            className="mx-auto mb-3 h-1 w-10 rounded-full bg-[var(--m-border-strong)]"
          />

          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="m-eyebrow">Quick capture</p>
              <DialogPrimitive.Title className="mt-1 text-xl font-semibold tracking-tight text-[var(--m-text)]">
                Add it to your day
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1 text-[13px] leading-snug text-[var(--m-text-2)]">
                One thought in, calendar entry out.
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close asChild>
              <button
                type="button"
                className="m-icon-button m-press"
                aria-label="Close quick capture"
              >
                <X width={19} height={19} />
              </button>
            </DialogPrimitive.Close>
          </div>

          <form className="mt-5" onSubmit={submit}>
            <fieldset>
              <legend className="sr-only">What are you adding?</legend>
              <div className="grid grid-cols-3 gap-2">
                {CAPTURE_TYPES.map((type) => {
                  const Icon = type.icon;
                  const selected = type.id === kind;
                  return (
                    <button
                      key={type.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => selectKind(type.id)}
                      className={cn(
                        "m-press flex min-w-0 flex-col items-start rounded-2xl border p-3 text-left",
                        selected
                          ? "border-[var(--m-text)] bg-[var(--m-primary)] text-[var(--m-primary-fg)]"
                          : "border-[var(--m-border)] bg-[var(--m-surface-2)] text-[var(--m-text)]",
                      )}
                    >
                      <Icon width={18} height={18} strokeWidth={2} />
                      <span className="mt-3 block text-[13px] font-semibold">
                        {type.label}
                      </span>
                      <span
                        className={cn(
                          "mt-0.5 block truncate text-[10px]",
                          selected
                            ? "text-white/65"
                            : "text-[var(--m-text-3)]",
                        )}
                      >
                        {type.description}
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <div className="mt-4">
              <label
                htmlFor="quick-capture-title"
                className="mb-1.5 block text-[12px] font-semibold text-[var(--m-text)]"
              >
                What’s happening?
              </label>
              <input
                ref={titleRef}
                id="quick-capture-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={activeType.placeholder}
                autoComplete="off"
                className="m-field w-full"
              />
            </div>

            <fieldset className="mt-4">
              <legend className="mb-2 text-[12px] font-semibold text-[var(--m-text)]">
                When?
              </legend>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    ["now", "Next slot"],
                    ["later", "In 2 hours"],
                    ["tomorrow", "Tomorrow"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => scheduleShortcut(value)}
                    className="m-secondary-button m-press min-w-0 truncate px-2 text-[12px]"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="m-field-shell">
                <CalendarDays
                  width={16}
                  height={16}
                  aria-hidden="true"
                  className="shrink-0 text-[var(--m-text-3)]"
                />
                <span className="sr-only">Date</span>
                <input
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                  className="min-w-0 flex-1 bg-transparent text-[16px] focus:outline-none"
                  required
                />
              </label>
              <label className="m-field-shell">
                <Clock3
                  width={16}
                  height={16}
                  aria-hidden="true"
                  className="shrink-0 text-[var(--m-text-3)]"
                />
                <span className="sr-only">Start time</span>
                <input
                  type="time"
                  value={time}
                  onChange={(event) => setTime(event.target.value)}
                  className="min-w-0 flex-1 bg-transparent text-[16px] focus:outline-none"
                  required
                />
              </label>
            </div>

            <label className="m-field-shell mt-2">
              <span className="flex-1 text-[13px] font-medium text-[var(--m-text-2)]">
                Duration
              </span>
              <select
                value={duration}
                onChange={(event) => setDuration(Number(event.target.value))}
                className="appearance-none bg-transparent text-right text-[16px] font-semibold text-[var(--m-text)] focus:outline-none"
              >
                {DURATIONS.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {minutes < 60
                      ? `${minutes} min`
                      : `${minutes / 60} hr`}
                  </option>
                ))}
              </select>
              <ChevronDown
                width={15}
                height={15}
                aria-hidden="true"
                className="text-[var(--m-text-3)]"
              />
            </label>

            {createMutation.isError && (
              <p
                className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-[12px] leading-snug text-red-700"
                role="alert"
              >
                We couldn’t add this right now. Check your connection and try
                again.
              </p>
            )}

            <button
              type="submit"
              disabled={!title.trim() || createMutation.isPending}
              className="m-primary-button m-press mt-4 w-full"
            >
              {createMutation.isPending
                ? "Adding…"
                : `Add ${activeType.label.toLowerCase()} to calendar`}
            </button>
          </form>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
