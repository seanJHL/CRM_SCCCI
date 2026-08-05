import { endOfDay, startOfDay } from "date-fns";
import type { Task } from "@/lib/query-keys";

/** A task counts as done only once every checklist item is ticked. */
export function isTaskComplete(task: Task): boolean {
  return task.items.length > 0 && task.items.every((item) => item.completed);
}

export function completedItemCount(task: Task): number {
  return task.items.filter((item) => item.completed).length;
}

/**
 * Tasks the calendar should place on `day`.
 *
 * A range request also returns undated tasks and overdue carry-overs so the
 * Today queue can surface them; neither belongs to a specific calendar square,
 * so only tasks actually due on the day are kept here.
 */
export function tasksDueOn(tasks: Task[] | undefined, day: Date): Task[] {
  const from = startOfDay(day).getTime();
  const to = endOfDay(day).getTime();
  return (tasks ?? [])
    .filter((task) => {
      if (!task.dueAt) return false;
      const due = new Date(task.dueAt).getTime();
      return due >= from && due <= to;
    })
    .sort(
      (a, b) =>
        new Date(a.dueAt as string).getTime() -
        new Date(b.dueAt as string).getTime(),
    );
}
