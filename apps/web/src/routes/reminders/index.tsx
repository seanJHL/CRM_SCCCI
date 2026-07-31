import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { queryKeys, type Reminder } from "@/lib/query-keys";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  Bell,
  BellRing,
  Clock,
  Repeat,
  Plus,
  X,
  Trash2,
  Check,
  Timer,
} from "lucide-react";

export const Route = createFileRoute("/reminders/")({
  component: RemindersPage,
});

function RemindersPage() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [scheduleType, setScheduleType] = useState<"interval" | "daily_time">(
    "daily_time"
  );
  const [intervalMinutes, setIntervalMinutes] = useState(90);
  const [timeOfDay, setTimeOfDay] = useState("09:00");

  const { data: reminders, isLoading } = useQuery({
    queryKey: queryKeys.reminders.all,
    queryFn: () => api.get<Reminder[]>("/api/reminders"),
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });

  const createMutation = useMutation({
    mutationFn: (data: unknown) => api.post("/api/reminders", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.reminders.all });
      setShowForm(false);
      setName("");
    },
  });

  const toggleMutation = useMutation({
    mutationFn: (id: string) => api.post(`/api/reminders/${id}/toggle`, {}),
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.reminders.all });
      const previous = queryClient.getQueryData<Reminder[]>(
        queryKeys.reminders.all
      );
      if (previous) {
        queryClient.setQueryData<Reminder[]>(
          queryKeys.reminders.all,
          previous.map((r) =>
            r.id === id ? { ...r, isActive: !r.isActive } : r
          )
        );
      }
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.reminders.all, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.reminders.all });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/reminders/${id}`),
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.reminders.all });
      const previous = queryClient.getQueryData<Reminder[]>(
        queryKeys.reminders.all
      );
      if (previous) {
        queryClient.setQueryData<Reminder[]>(
          queryKeys.reminders.all,
          previous.filter((r) => r.id !== id)
        );
      }
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.reminders.all, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.reminders.all });
    },
  });

  function handleCreate() {
    if (!name.trim()) return;
    createMutation.mutate({
      name: name.trim(),
      scheduleType,
      intervalMinutes: scheduleType === "interval" ? intervalMinutes : undefined,
      timeOfDay: scheduleType === "daily_time" ? timeOfDay : undefined,
    });
  }

  const activeCount = reminders?.filter((r) => r.isActive).length ?? 0;

  return (
    <div className="page-container">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Reminders</h1>
          <p className="page-subtitle">
            {activeCount} active reminder{activeCount !== 1 ? "s" : ""}
          </p>
        </div>
        <Button
          onClick={() => setShowForm(!showForm)}
          variant={showForm ? "outline" : "default"}
          size="sm"
        >
          {showForm ? (
            <>
              <X className="mr-1.5 h-3.5 w-3.5" />
              Cancel
            </>
          ) : (
            <>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              New Reminder
            </>
          )}
        </Button>
      </div>

      {/* Create form */}
      {showForm && (
        <Card className="mb-6">
          <CardHeader className="pb-4">
            <CardTitle>Create Reminder</CardTitle>
            <CardDescription>
              Set up a recurring reminder to stay on track
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="section-heading mb-1.5 block">
                  Reminder name
                </label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Drink water, Stand up, Stretch..."
                  onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                />
              </div>
              <div>
                <label className="section-heading mb-1.5 block">
                  Schedule type
                </label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={scheduleType === "daily_time" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setScheduleType("daily_time")}
                    className="flex-1"
                  >
                    <Clock className="mr-1.5 h-3.5 w-3.5" />
                    Daily
                  </Button>
                  <Button
                    type="button"
                    variant={scheduleType === "interval" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setScheduleType("interval")}
                    className="flex-1"
                  >
                    <Repeat className="mr-1.5 h-3.5 w-3.5" />
                    Interval
                  </Button>
                </div>
              </div>
              <div>
                {scheduleType === "daily_time" ? (
                  <>
                    <label className="section-heading mb-1.5 block">
                      Time of day
                    </label>
                    <Input
                      type="time"
                      value={timeOfDay}
                      onChange={(e) => setTimeOfDay(e.target.value)}
                    />
                  </>
                ) : (
                  <>
                    <label className="section-heading mb-1.5 block">
                      Every N minutes
                    </label>
                    <Input
                      type="number"
                      value={intervalMinutes}
                      onChange={(e) => setIntervalMinutes(Number(e.target.value))}
                      min={5}
                      step={5}
                    />
                  </>
                )}
              </div>
            </div>
            <div className="mt-5 flex justify-end">
              <Button
                onClick={handleCreate}
                disabled={!name.trim() || createMutation.isPending}
              >
                {createMutation.isPending ? "Creating..." : "Create Reminder"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Reminders list */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-lg border border-border bg-card p-4"
            >
              <div className="flex items-center gap-3">
                <Skeleton className="h-8 w-8 rounded-md" />
                <Skeleton className="h-4 w-32" />
              </div>
              <div className="flex items-center gap-3">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-5 w-5" />
              </div>
            </div>
          ))}
        </div>
      ) : reminders && reminders.length > 0 ? (
        <div className="space-y-1.5">
          {reminders.map((reminder) => (
            <div
              key={reminder.id}
              className={cn(
                "group flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:bg-muted/30",
                !reminder.isActive && "opacity-50"
              )}
            >
              <div className="flex items-center gap-3">
                {/* Toggle button */}
                <button
                  onClick={() => toggleMutation.mutate(reminder.id)}
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition-colors",
                    reminder.isActive
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-background hover:border-muted-foreground/50"
                  )}
                >
                  {reminder.isActive && <Check className="h-3.5 w-3.5" />}
                </button>

                {/* Name & icon */}
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    {reminder.isActive ? (
                      <BellRing className="h-3.5 w-3.5" />
                    ) : (
                      <Bell className="h-3.5 w-3.5" />
                    )}
                  </div>
                  <span
                    className={cn(
                      "text-sm",
                      reminder.isActive
                        ? "font-medium text-foreground"
                        : "text-muted-foreground line-through"
                    )}
                  >
                    {reminder.name}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2.5">
                {/* Schedule badge */}
                <Badge variant="outline" className="gap-1 text-[11px]">
                  {reminder.scheduleType === "interval" ? (
                    <>
                      <Timer className="h-3 w-3" />
                      every {reminder.intervalMinutes}m
                    </>
                  ) : (
                    <>
                      <Clock className="h-3 w-3" />
                      {reminder.timeOfDay}
                    </>
                  )}
                </Badge>

                {/* Delete */}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => deleteMutation.mutate(reminder.id)}
                  className="h-7 w-7 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Card className="flex flex-col items-center justify-center py-16 text-center">
          <Bell className="mb-3 h-8 w-8 text-muted-foreground/30" />
          <h3 className="text-base font-semibold text-foreground">
            No reminders yet
          </h3>
          <p className="mt-1 max-w-xs text-sm text-muted-foreground">
            Create reminders to stay on track with your daily habits and goals.
          </p>
          <Button className="mt-5" onClick={() => setShowForm(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Create your first reminder
          </Button>
        </Card>
      )}
    </div>
  );
}
