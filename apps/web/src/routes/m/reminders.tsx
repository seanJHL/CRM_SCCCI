import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Bell, BellRing, Plus, X, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { queryKeys, type Reminder } from "@/lib/query-keys";
import { TimeWheelPicker } from "@/components/mobile/time-wheel-picker";
import { WheelColumn } from "@/components/mobile/wheel-column";
import { TogglePill } from "@/components/mobile/toggle-pill";
import { notify } from "@/components/mobile/notification-banner";
import { cn } from "@/lib/utils";
import { MobileErrorState } from "@/components/mobile/error-state";
import { PushNotificationCard } from "@/components/mobile/push-notification-card";

export const Route = createFileRoute("/m/reminders")({
  validateSearch: (search: Record<string, unknown>): { new?: boolean } => ({
    new: search.new === "1" ? true : undefined,
  }),
  component: MobileReminders,
});

/** 12h display string for a "HH:mm" 24h time, e.g. "9:00 AM". */
function format12h(time: string | null | undefined): string {
  if (!time) return "—";
  const [hRaw, mRaw] = time.split(":").map(Number);
  if (Number.isNaN(hRaw) || Number.isNaN(mRaw)) return "—";
  const ampm = hRaw < 12 ? "AM" : "PM";
  const h12 = hRaw === 0 ? 12 : hRaw > 12 ? hRaw - 12 : hRaw;
  return `${h12}:${String(mRaw).padStart(2, "0")} ${ampm}`;
}

function MobileReminders() {
  const { new: openNew } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    if (openNew) {
      setShowForm(true);
      setEditingId(null);
      void navigate({ to: "/m/reminders", search: {}, replace: true });
    }
  }, [openNew, navigate]);

  const {
    data: reminders,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: queryKeys.reminders.all,
    queryFn: () => api.get<Reminder[]>("/api/reminders"),
    staleTime: 120_000,
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch(`/api/reminders/${id}`, { isActive }),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: queryKeys.reminders.all }),
    onError: () =>
      notify({
        title: "Couldn't update reminder",
        body: "Check your connection and try again.",
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/reminders/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.reminders.all });
      setEditingId(null);
      notify({ title: "Reminder removed" });
    },
    onError: () =>
      notify({
        title: "Couldn't remove reminder",
        body: "Check your connection and try again.",
      }),
  });

  const list = reminders ?? [];
  const activeCount = list.filter((r) => r.isActive).length;
  const editingReminder = editingId
    ? (list.find((r) => r.id === editingId) ?? null)
    : null;

  function openCreate() {
    setEditingId(null);
    setShowForm(true);
  }

  function openEdit(id: string) {
    setShowForm(false);
    setEditingId(id);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
  }

  return (
    <div className="m-controller-page flex flex-col gap-5">
      <header className="m-anim-slide-up flex items-center justify-between">
        <div>
          <p className="m-eyebrow">Alarms</p>
          <h1 className="mt-1 text-[28px] font-semibold tracking-tight text-[var(--m-text)]">
            Reminders
          </h1>
          <p className="mt-1.5 text-[13px] text-[var(--m-text-2)]">
            {list.length === 0
              ? "Quick point-in-time nudges."
              : `${activeCount} active · pushed to your device.`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => (showForm || editingId ? closeForm() : openCreate())}
          aria-label={showForm || editingId ? "Close form" : "Add reminder"}
          className={cn(
            "m-press flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition-colors",
            showForm || editingId
              ? "border border-[var(--m-border)] bg-[var(--m-surface-2)] text-[var(--m-text-2)]"
              : "bg-[var(--m-primary)] text-[var(--m-primary-fg)] shadow-[0_8px_20px_rgba(0,0,0,0.16)]",
          )}
        >
          {showForm || editingId ? (
            <X width={19} height={19} strokeWidth={2.2} />
          ) : (
            <Plus width={19} height={19} strokeWidth={2.2} />
          )}
        </button>
      </header>

      <PushNotificationCard />

      {showForm && !editingId && (
        <ReminderForm onDone={closeForm} onCancel={closeForm} />
      )}
      {editingReminder && (
        <ReminderForm
          key={editingReminder.id}
          reminder={editingReminder}
          onDone={closeForm}
          onCancel={closeForm}
          onDelete={() => deleteMutation.mutate(editingReminder.id)}
          deleting={deleteMutation.isPending}
        />
      )}

      {isError && (
        <MobileErrorState
          title="Reminders unavailable"
          onRetry={() => void refetch()}
        />
      )}

      <div className="flex flex-col gap-2.5">
        {isLoading &&
          Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="m-skeleton h-[78px] rounded-2xl" />
          ))}

        {list.map((reminder, i) => (
          <AlarmRow
            key={reminder.id}
            reminder={reminder}
            index={i}
            onToggle={(next) =>
              toggleMutation.mutate({ id: reminder.id, isActive: next })
            }
            onEdit={() => openEdit(reminder.id)}
            toggling={toggleMutation.isPending}
          />
        ))}

        {!isLoading && list.length === 0 && (
          <div className="m-inset flex flex-col items-center gap-2 px-6 py-12 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--m-surface-3)] text-[var(--m-text-3)]">
              <BellRing width={20} height={20} />
            </span>
            <p className="text-sm font-medium text-[var(--m-text-2)]">
              No alarms yet
            </p>
            <p className="text-[12px] leading-relaxed text-[var(--m-text-3)]">
              Tap + to set a time. Ember will ping your device the moment it hits.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/** A single alarm row — large time, label, and an iOS-style switch. */
function AlarmRow({
  reminder,
  index,
  onToggle,
  onEdit,
  toggling,
}: {
  reminder: Reminder;
  index: number;
  onToggle: (next: boolean) => void;
  onEdit: () => void;
  toggling: boolean;
}) {
  return (
    <article
      className="m-card m-stagger p-3.5"
      style={{ ["--m-i" as string]: index }}
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onEdit}
          className="m-press flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left"
          aria-label={`Edit ${reminder.name}`}
        >
          <span
            className={cn(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-colors",
              reminder.isActive
                ? "bg-[var(--m-primary)] text-[var(--m-primary-fg)]"
                : "bg-[var(--m-surface-2)] text-[var(--m-text-3)]",
            )}
            aria-hidden="true"
          >
            {reminder.isActive ? (
              <BellRing width={18} height={18} />
            ) : (
              <Bell width={18} height={18} />
            )}
          </span>

          <div className="min-w-0 flex-1">
            {reminder.scheduleType === "daily_time" ? (
              <p
                className={cn(
                  "tabular-nums leading-none",
                  reminder.isActive
                    ? "text-[26px] font-semibold tracking-tight text-[var(--m-text)]"
                    : "text-[26px] font-semibold tracking-tight text-[var(--m-text-3)]",
                )}
              >
                {format12h(reminder.timeOfDay)}
              </p>
            ) : (
              <p
                className={cn(
                  "flex items-baseline gap-1.5 leading-none",
                  reminder.isActive
                    ? "text-[var(--m-text)]"
                    : "text-[var(--m-text-3)]",
                )}
              >
                <span className="text-[13px] font-medium">Every</span>
                <span className="text-[26px] font-semibold tabular-nums tracking-tight">
                  {reminder.intervalMinutes ?? 0}
                </span>
                <span className="text-[13px] font-medium">min</span>
              </p>
            )}
            <p className="mt-1 truncate text-[12px] text-[var(--m-text-3)]">
              {reminder.name}
            </p>
          </div>
        </button>

        <TogglePill
          checked={reminder.isActive}
          disabled={toggling}
          onChange={onToggle}
          label={`${reminder.isActive ? "Disable" : "Enable"} ${reminder.name}`}
        />
      </div>
    </article>
  );
}

const INTERVAL_PRESETS = [1, 5, 10, 15, 20, 25, 30, 45, 60, 90, 120, 180];

/** Build the interval wheel values, guaranteeing the current value is present. */
function useIntervalValues(current: number) {
  return useMemo(() => {
    const set = new Set(INTERVAL_PRESETS);
    if (current > 0 && !set.has(current)) set.add(current);
    return Array.from(set).sort((a, b) => a - b).map(String);
  }, [current]);
}

function ReminderForm({
  reminder,
  onDone,
  onCancel,
  onDelete,
  deleting,
}: {
  reminder?: Reminder;
  onDone: () => void;
  onCancel: () => void;
  onDelete?: () => void;
  deleting?: boolean;
}) {
  const queryClient = useQueryClient();
  const isEdit = !!reminder;
  const [name, setName] = useState(reminder?.name ?? "");
  const [scheduleType, setScheduleType] = useState<"daily_time" | "interval">(
    reminder?.scheduleType ?? "daily_time",
  );
  const [timeOfDay, setTimeOfDay] = useState(reminder?.timeOfDay ?? "09:00");
  const [intervalMinutes, setIntervalMinutes] = useState(
    reminder?.intervalMinutes ?? 90,
  );
  const [touched, setTouched] = useState(false);

  const intervalValues = useIntervalValues(intervalMinutes);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Singapore";

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api.post("/api/reminders", payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.reminders.all });
      onDone();
      notify({ title: "Reminder set", body: "Ember will ping you." });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api.patch(`/api/reminders/${reminder!.id}`, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.reminders.all });
      onDone();
      notify({ title: "Reminder updated" });
    },
  });

  const pending = createMutation.isPending || updateMutation.isPending;
  const error = createMutation.isError || updateMutation.isError;

  function submit() {
    if (!name.trim()) {
      setTouched(true);
      return;
    }
    const payload =
      scheduleType === "daily_time"
        ? { name: name.trim(), scheduleType, timeOfDay, timeZone }
        : { name: name.trim(), scheduleType, intervalMinutes, timeZone };
    if (isEdit) updateMutation.mutate(payload);
    else createMutation.mutate(payload);
  }

  return (
    <form
      className="m-card m-anim-pop p-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="mb-1 flex items-center justify-between">
        <p className="text-[15px] font-semibold">
          {isEdit ? "Edit reminder" : "New reminder"}
        </p>
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--m-text-3)]">
          {scheduleType === "daily_time" ? "Alarm" : "Recurring nudge"}
        </span>
      </div>
      <p className="text-[11px] text-[var(--m-text-3)]">
        Set exactly when it should ping you.
      </p>

      <label
        htmlFor="reminder-name"
        className="mb-1.5 mt-3 block text-[12px] font-semibold text-[var(--m-text)]"
      >
        Label
      </label>
      <input
        id="reminder-name"
        autoFocus={!isEdit}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Stand up, Stretch, Drink water…"
        className="m-field w-full"
      />
      {touched && name.trim() === "" && (
        <p className="mt-1 text-[11px] text-red-400">A label is required.</p>
      )}

      <fieldset className="mt-3">
        <legend className="mb-1.5 text-[12px] font-semibold text-[var(--m-text)]">
          When
        </legend>
        <div className="m-inset flex p-1">
          {(["daily_time", "interval"] as const).map((type) => (
            <button
              key={type}
              type="button"
              aria-pressed={scheduleType === type}
              onClick={() => setScheduleType(type)}
              className={cn(
                "m-press min-h-11 flex-1 rounded-lg px-2 text-[13px] font-medium transition-all",
                scheduleType === type
                  ? "bg-[var(--m-primary)] text-[var(--m-primary-fg)] shadow-sm"
                  : "text-[var(--m-text-3)]",
              )}
            >
              {type === "daily_time" ? "At a time" : "Every…"}
            </button>
          ))}
        </div>
      </fieldset>

      {scheduleType === "daily_time" ? (
        <div className="relative mt-3 overflow-hidden rounded-2xl border border-white/10 bg-black/30 p-3">
          <TimeWheelPicker
            value={timeOfDay}
            onChange={setTimeOfDay}
            className="mx-auto max-w-[280px]"
          />
        </div>
      ) : (
        <div className="relative mt-3 overflow-hidden rounded-2xl border border-white/10 bg-black/30 p-3">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-2 z-0 rounded-lg border-y border-white/10 bg-white/[0.06]"
            style={{ top: "calc(50% - 20px)", height: 40 }}
          />
          <div className="relative z-10 flex items-stretch">
            <span className="self-center pr-2 text-[15px] font-medium text-[var(--m-text-2)]">
              Every
            </span>
            <WheelColumn
              ariaLabel="Interval minutes"
              values={intervalValues}
              value={String(intervalMinutes)}
              onChange={(v) => setIntervalMinutes(Number(v))}
              className="flex-1"
            />
            <span className="self-center pl-2 text-[15px] font-medium text-[var(--m-text-2)]">
              min
            </span>
          </div>
        </div>
      )}

      {error && (
        <p className="mt-3 text-[12px] text-red-400" role="alert">
          Couldn't save this reminder. Please try again.
        </p>
      )}

      <div className="mt-4 flex gap-2">
        {isEdit && onDelete && (
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting}
            aria-label="Delete reminder"
            className="m-press flex min-h-12 items-center justify-center gap-1.5 rounded-xl border border-red-400/30 bg-red-400/10 px-4 text-[13px] font-semibold text-red-300 disabled:opacity-50"
          >
            <Trash2 width={15} height={15} />
            {deleting ? "Deleting…" : "Delete"}
          </button>
        )}
        <button
          type="button"
          onClick={onCancel}
          className="m-secondary-button m-press flex-1"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          className="m-primary-button m-press flex-1"
        >
          {pending ? "Saving…" : isEdit ? "Save" : "Set reminder"}
        </button>
      </div>
    </form>
  );
}
