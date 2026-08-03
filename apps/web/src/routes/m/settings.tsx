import { createFileRoute, redirect } from "@tanstack/react-router";

/** Keep old bookmarks working after the Settings page was removed. */
export const Route = createFileRoute("/m/settings")({
  beforeLoad: () => {
    throw redirect({ to: "/m" });
  },
});
