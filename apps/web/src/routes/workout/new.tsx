import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/workout/new")({
  beforeLoad: () => {
    throw redirect({ to: "/workouts/new" });
  },
});
