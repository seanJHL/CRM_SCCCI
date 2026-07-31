import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Bell, BellRing, Clock, Repeat, Plus, X, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { queryKeys, type Reminder } from "@/lib/query-keys";
import { TogglePill } from "@/components/mobile/toggle-pill";
import { notify } from "@/components/mobile/notification-banner";
import { cn } from "@/lib/utils";
import { MobileErrorState } from "@/components/mobile/error-state";

export const Route = createFileRoute("/m/reminders")({
  validateSearch: (search: Record<string, unknown>): { new?: boolean } => ({
    new: search.new === "1" ? true : undefined,
  }),
  component: MobileReminders,
});

function MobileReminders() {
  const { new: openNew } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  useEffect(() => {
    if (openNew) {
      setShowForm(true);
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
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.reminders.all }),
    onError: () =>
      notify({
        title: "Couldn’t update reminder",
        body: "Check your connection and try again.",
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/reminders/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.reminders.all });
      setDeleteConfirmId(null);
      notify({ title: "Reminder removed" });
    },
    onError: () =>
      notify({
        title: "Couldn’t remove reminder",
        body: "Check your connection and try again.",
      }),
  });

  const activeCount = (reminders ?? []).filter((r) => r.isActive).length;

  return (
    <div className="flex flex-col gap-5">
      <header className="m-anim-slide-up flex items-center justify-between">
        <div>
          <p className="m-eyebrow">Alerts & reminders</p>
          <h1 className="mt-1 text-[28px] font-semibold tracking-tight text-[var(--m-text)]">
            Stay on it
          </h1>
          <p className="mt-1.5 text-[13px] text-[var(--m-text-2)]">
            {(reminders ?? []).length === 0 ? "No reminders yet." : `${activeCount} active · pushed to your device.`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          aria-label="Add reminder"
          className={cn(
            "m-press flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition-colors",
            showForm
              ? "border border-[var(--m-border)] bg-[var(--m-surface-2)] text-[var(--m-text-2)]"
              : "bg-[var(--m-primary)] text-[var(--m-primary-fg)] shadow-[0_8px_20px_rgba(0,0,0,0.16)]",
          )}
        >
          {showForm ? <X width={19} height={19} strokeWidth={2.2} /> : <Plus width={19} height={19} strokeWidth={2.2} />}
        </button>
      </header>

      {showForm && <AddReminderForm onDone={() => setShowForm(false)} />}

      {isError && (
        <MobileErrorState
          title="Reminders unavailable"
          onRetry={() => void refetch()}
        />
      )}

      <div className="flex flex-col gap-2.5">
        {isLoading && Array.from({ length: 2 }).map((_, i) => <div key={i} className="m-skeleton h-[64px] rounded-xl" />)}

        {(reminders ?? []).map((reminder, i) => {
          const confirmingDelete = deleteConfirmId === reminder.id;
          return (
            <article
              key={reminder.id}
              className="m-card m-stagger p-3.5"
              style={{ ["--m-i" as string]: i }}
            >
              <div className="flex items-center gap-3">
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
                  <h2
                    className={cn(
                      "truncate text-[14px] font-semibold",
                      reminder.isActive
                        ? "text-[var(--m-text)]"
                        : "text-[var(--m-text-3)]",
                    )}
                  >
                    {reminder.name}
                  </h2>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[var(--m-text-3)]">
                    {reminder.scheduleType === "daily_time" ? (
                      <>
                        <Clock width={12} height={12} /> Daily at {reminder.timeOfDay}
                      </>
                    ) : (
                      <>
                        <Repeat width={12} height={12} /> Every {reminder.intervalMinutes} min
                      </>
                    )}
                  </p>
                </div>

                <TogglePill
                  checked={reminder.isActive}
                  disabled={toggleMutation.isPending}
                  onChange={(next) =>
                    toggleMutation.mutate({ id: reminder.id, isActive: next })
                  }
                  label={`${reminder.isActive ? "Disable" : "Enable"} ${reminder.name}`}
                />
              </div>

              <div className="mt-3 flex items-center justify-end border-t border-[var(--m-border)] pt-2">
                {confirmingDelete && (
                  <button
                    type="button"
                    onClick={() => setDeleteConfirmId(null)}
                    className="m-press mr-1 min-h-11 rounded-lg px-3 text-[12px] font-medium text-[var(--m-text-2)]"
                  >
                    Cancel
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (confirmingDelete) {
                      deleteMutation.mutate(reminder.id);
                    } else {
                      setDeleteConfirmId(reminder.id);
                    }
                  }}
                  disabled={deleteMutation.isPending}
                  className={cn(
                    "m-press flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-[12px] font-medium",
                    confirmingDelete
                      ? "bg-red-50 text-red-700"
                      : "text-[var(--m-text-3)]",
                  )}
                  aria-label={
                    confirmingDelete
                      ? `Confirm delete ${reminder.name}`
                      : `Delete ${reminder.name}`
                  }
                >
                  <Trash2 width={14} height={14} />
                  {confirmingDelete ? "Confirm delete" : "Delete"}
                </button>
              </div>
            </article>
          );
        })}

        {!isLoading && (reminders ?? []).length === 0 && (
          <div className="m-inset flex flex-col items-center gap-2 px-6 py-10 text-center">
            <p className="text-sm font-medium text-[var(--m-text-2)]">Nothing to remind you yet</p>
            <p className="text-[12px] leading-relaxed text-[var(--m-text-3)]">
              Add a reminder and Ember will nudge you with a push notification.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function AddReminderForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [scheduleType, setScheduleType] = useState<"daily_time" | "interval">("daily_time");
  const [timeOfDay, setTimeOfDay] = useState("09:00");
  const [intervalMinutes, setIntervalMinutes] = useState(90);

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post("/api/reminders", payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.reminders.all });
      onDone();
      notify({ title: "Reminder set", body: "Ember will ping you." });
    },
  });

  const submit = () => {
    if (!name.trim()) return;
    createMutation.mutate(
      scheduleType === "daily_time"
        ? { name: name.trim(), scheduleType, timeOfDay }
        : { name: name.trim(), scheduleType, intervalMinutes },
    );
  };

  return (
    <form
      className="m-card m-anim-pop p-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="mb-3">
        <p className="text-[15px] font-semibold">New reminder</p>
        <p className="text-[11px] text-[var(--m-text-3)]">
          Choose a time or a repeating interval.
        </p>
      </div>
      <label
        htmlFor="reminder-name"
        className="mb-1.5 block text-[12px] font-semibold text-[var(--m-text)]"
      >
        Reminder
      </label>
      <input
        id="reminder-name"
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Drink water"
        className="m-field w-full"
      />

      <fieldset className="mt-3">
        <legend className="mb-1.5 text-[12px] font-semibold text-[var(--m-text)]">
          Repeat
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
              scheduleType === type ? "bg-white text-[var(--m-text)] shadow-sm" : "text-[var(--m-text-3)]",
            )}
          >
            {type === "daily_time" ? "Daily at…" : "Every…"}
          </button>
        ))}
        </div>
      </fieldset>

      {scheduleType === "daily_time" ? (
        <label className="m-field-shell mt-3">
          <Clock width={14} height={14} className="text-[var(--m-text-3)]" />
          <span className="sr-only">Reminder time</span>
          <input
            type="time"
            value={timeOfDay}
            onChange={(e) => setTimeOfDay(e.target.value)}
            className="w-full bg-transparent text-[16px] text-[var(--m-text)] focus:outline-none"
          />
        </label>
      ) : (
        <label className="m-field-shell mt-3">
          <Repeat width={14} height={14} className="text-[var(--m-text-3)]" />
          <span className="text-[12px] text-[var(--m-text-3)]">Every</span>
          <input
            type="number"
            min={1}
            value={intervalMinutes}
            onChange={(e) => setIntervalMinutes(Number(e.target.value))}
            aria-label="Repeat interval in minutes"
            className="w-16 bg-transparent text-center text-[16px] font-semibold text-[var(--m-text)] focus:outline-none"
          />
          <span className="text-[12px] text-[var(--m-text-3)]">minutes</span>
        </label>
      )}

      {createMutation.isError && (
        <p className="mt-3 text-[12px] text-red-700" role="alert">
          Couldn’t set this reminder. Please try again.
        </p>
      )}
      <button
        type="submit"
        disabled={!name.trim() || createMutation.isPending}
        className="m-primary-button m-press mt-4 w-full"
      >
        {createMutation.isPending ? "Setting…" : "Set reminder"}
      </button>
    </form>
  );
}
