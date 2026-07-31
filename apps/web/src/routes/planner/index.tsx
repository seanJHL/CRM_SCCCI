import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Clock, Target, CheckCircle2, Circle, SkipForward, ListTodo } from "lucide-react";
import { api } from "@/lib/api";
import { queryKeys, type PlannerTask, type PlannerBlock } from "@/lib/query-keys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/planner/")({
  component: PlannerPage,
});

function PlannerPage() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [deadline, setDeadline] = useState("");
  const [effort, setEffort] = useState(4);
  const [description, setDescription] = useState("");

  const { data: tasks, isLoading } = useQuery({
    queryKey: queryKeys.planner.tasks,
    queryFn: () => api.get<PlannerTask[]>("/api/planner/tasks"),
    staleTime: 120_000, gcTime: 600_000,
  });

  const createMutation = useMutation({
    mutationFn: (data: unknown) => api.post("/api/planner/tasks", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.planner.tasks });
      setShowForm(false);
      setTitle(""); setDeadline(""); setEffort(4); setDescription("");
    },
  });

  function handleCreate() {
    if (!title.trim() || !deadline) return;
    createMutation.mutate({
      title: title.trim(),
      deadlineAt: new Date(deadline).toISOString(),
      effortEstimateHours: effort,
      description: description.trim() || null,
    });
  }

  return (
    <div className="px-4 py-8 sm:px-8 lg:px-12">
      <div className="page-header flex items-start justify-between sm:items-center">
        <div>
          <h1 className="page-title">Planner</h1>
          <p className="page-subtitle">Set deadline &amp; effort — Ember plans your blocks.</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)} variant={showForm ? "outline" : "default"} className="gap-1">
          {showForm ? "Cancel" : <><Plus className="h-3.5 w-3.5" /> New Task</>}
        </Button>
      </div>

      {showForm && (
        <Card className="mb-6">
          <CardContent className="p-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Title</label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="40% University coursework" />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Deadline</label>
                <Input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Effort (hours)</label>
                <Input type="number" value={effort} onChange={(e) => setEffort(Number(e.target.value))} min={0.5} step={0.5} />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Description</label>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Notes..." rows={2} />
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <Button onClick={handleCreate} disabled={!title.trim() || !deadline || createMutation.isPending}>
                {createMutation.isPending ? "Planning..." : "Plan it"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {isLoading
          ? Array.from({ length: 2 }).map((_, i) => (
              <Card key={i}><CardContent className="p-5"><Skeleton className="mb-2 h-4 w-40" /><Skeleton className="h-3 w-24" /></CardContent></Card>
            ))
          : tasks?.map((task) => <TaskCard key={task.id} task={task} />)}
        {(!tasks || tasks.length === 0) && !showForm && !isLoading && (
          <Card className="flex flex-col items-center py-16 text-center">
            <ListTodo className="mb-2 h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm font-medium text-foreground">No tasks yet</p>
            <p className="mt-1 text-[13px] text-muted-foreground">Create one and Ember will plan your time.</p>
            <Button className="mt-4" onClick={() => setShowForm(true)}><Plus className="mr-1 h-3.5 w-3.5" /> New Task</Button>
          </Card>
        )}
      </div>
    </div>
  );
}

function TaskCard({ task }: { task: PlannerTask }) {
  const { data: detail } = useQuery({
    queryKey: queryKeys.planner.detail(task.id),
    queryFn: () => api.get<PlannerTask & { blocks: PlannerBlock[] }>(`/api/planner/tasks/${task.id}`),
    staleTime: 120_000, gcTime: 600_000,
  });

  const blocks = detail?.blocks ?? [];
  const doneBlocks = blocks.filter((b) => b.status === "done");
  const plannedBlocks = blocks.filter((b) => b.status === "planned");
  const totalPlannedHours = plannedBlocks.reduce((s, b) => s + (new Date(b.scheduledEnd).getTime() - new Date(b.scheduledStart).getTime()) / 3600000, 0);
  const daysUntil = Math.ceil((new Date(task.deadlineAt).getTime() - Date.now()) / 86400000);
  const pct = task.effortEstimateHours > 0 ? Math.min(100, (doneBlocks.length * 1.5 / task.effortEstimateHours) * 100) : 0;

  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-2 flex items-start justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground">{task.title}</h3>
            {task.description && <p className="mt-0.5 text-[13px] text-muted-foreground">{task.description}</p>}
          </div>
          <Badge variant="secondary" className="text-[10px] capitalize">{task.status.replace("_", " ")}</Badge>
        </div>

        <div className="mb-3 flex flex-wrap gap-3 text-[12px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Target className="h-3 w-3" />
            <strong className={cn("text-foreground", daysUntil <= 2 && "text-destructive")}>
              {new Date(task.deadlineAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </strong>
            <span className="text-[11px]">({daysUntil}d)</span>
          </span>
          <span className="flex items-center gap-1"><Clock className="h-3 w-3" /><strong className="text-foreground">{task.effortEstimateHours}h</strong> effort</span>
          <span className="flex items-center gap-1"><Clock className="h-3 w-3" /><strong className="text-foreground">{totalPlannedHours.toFixed(1)}h</strong> left</span>
        </div>

        {blocks.length > 0 && (
          <div className="mb-3 space-y-0.5">
            {blocks.slice(0, 5).map((b) => (
              <div key={b.id} className={cn("flex items-center gap-2 rounded px-2 py-1 text-[11px]",
                b.status === "done" && "bg-muted text-foreground",
                b.status === "skipped" && "text-muted-foreground line-through",
                b.status === "planned" && "text-foreground",
              )}>
                {b.status === "done" ? <CheckCircle2 className="h-3 w-3" /> : b.status === "skipped" ? <SkipForward className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
                <span className="font-medium">
                  {new Date(b.scheduledStart).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                </span>
                <span>
                  {new Date(b.scheduledStart).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} – {new Date(b.scheduledEnd).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                </span>
                <Badge variant="outline" className="ml-auto text-[9px] capitalize">{b.status}</Badge>
              </div>
            ))}
            {blocks.length > 5 && <p className="pl-6 text-[11px] text-muted-foreground">+{blocks.length - 5} more</p>}
          </div>
        )}

        <div className="flex items-center gap-2">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-foreground transition-all" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-[10px] font-semibold text-foreground">{Math.round(pct)}%</span>
        </div>
      </CardContent>
    </Card>
  );
}
