import { type FormEvent, useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { api } from "@/lib/api";
import { EXERCISE_CATEGORIES } from "@/lib/exercise-data";
import { queryKeys, type Exercise } from "@/lib/query-keys";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface CreateExerciseDialogProps {
  initialName?: string;
  onCreated?: (exercise: Exercise) => void;
  triggerLabel?: string;
  className?: string;
  initialTrackingType?: "strength" | "run";
}

const EQUIPMENT_OPTIONS = [
  { value: "free_weight", label: "Free weight" },
  { value: "machine", label: "Machine" },
  { value: "bodyweight", label: "Bodyweight" },
  { value: "cardio", label: "Cardio machine" },
  { value: "outdoor", label: "Outdoor" },
  { value: "other", label: "Other" },
] as const;

export function CreateExerciseDialog({
  initialName = "",
  onCreated,
  triggerLabel = "New exercise",
  className,
  initialTrackingType = "strength",
}: CreateExerciseDialogProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initialName);
  const [category, setCategory] = useState("chest");
  const [equipmentType, setEquipmentType] = useState("free_weight");
  const [trackingType, setTrackingType] = useState<"strength" | "run">(
    initialTrackingType,
  );

  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setTrackingType(initialTrackingType);
    setCategory(initialTrackingType === "run" ? "cardio" : "chest");
    setEquipmentType(initialTrackingType === "run" ? "outdoor" : "free_weight");
  }, [initialName, initialTrackingType, open]);

  const createMutation = useMutation({
    mutationFn: () =>
      api.post<Exercise>("/api/exercises", {
        name: name.trim(),
        category,
        equipmentType,
        trackingType,
      }),
    onSuccess: async (exercise) => {
      queryClient.setQueryData<Exercise[]>(
        queryKeys.exercises.all,
        (current = []) =>
          [...current.filter((item) => item.id !== exercise.id), exercise].sort(
            (a, b) => a.name.localeCompare(b.name),
          ),
      );
      await queryClient.invalidateQueries({
        queryKey: queryKeys.exercises.all,
      });
      onCreated?.(exercise);
      setOpen(false);
      setName("");
      setCategory("chest");
      setEquipmentType("free_weight");
      setTrackingType("strength");
    },
  });

  function handleTrackingType(value: "strength" | "run") {
    setTrackingType(value);
    if (value === "run") {
      setCategory("cardio");
      setEquipmentType("outdoor");
    } else {
      setCategory("chest");
      setEquipmentType("free_weight");
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || createMutation.isPending) return;
    createMutation.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className={className}>
          <Plus className="h-3.5 w-3.5" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader className="border-b border-border p-5 pr-12">
            <DialogTitle>Add a new exercise</DialogTitle>
            <DialogDescription>
              Save it to the exercise library and use it in any workout.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 p-5">
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold text-foreground">
                Exercise name
              </span>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Single-leg box squat"
                autoFocus
                maxLength={120}
              />
            </label>

            <div>
              <span className="mb-1.5 block text-[11px] font-semibold text-foreground">
                How is it tracked?
              </span>
              <Select
                value={trackingType}
                onValueChange={(value) =>
                  handleTrackingType(value as "strength" | "run")
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="strength">
                    Sets, reps, and weight
                  </SelectItem>
                  <SelectItem value="run">Run distance and time</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <span className="mb-1.5 block text-[11px] font-semibold text-foreground">
                  Category
                </span>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(EXERCISE_CATEGORIES)
                      .sort(([, a], [, b]) => a.order - b.order)
                      .map(([value, meta]) => (
                        <SelectItem key={value} value={value}>
                          {meta.label}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <span className="mb-1.5 block text-[11px] font-semibold text-foreground">
                  Equipment
                </span>
                <Select
                  value={equipmentType}
                  onValueChange={setEquipmentType}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EQUIPMENT_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {createMutation.isError && (
              <p className="rounded-lg bg-red-50 p-3 text-[12px] text-red-700">
                {createMutation.error instanceof Error
                  ? createMutation.error.message
                  : "The exercise could not be created."}
              </p>
            )}
          </div>

          <DialogFooter className="border-t border-border p-5">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!name.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? "Adding…" : "Add exercise"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
