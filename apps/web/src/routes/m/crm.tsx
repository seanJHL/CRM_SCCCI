import { createFileRoute, redirect } from "@tanstack/react-router";
import { CrmDashboard } from "@/routes/crm";
import { loadSession, type SessionData } from "@/lib/crm";

export const Route = createFileRoute("/m/crm")({
  beforeLoad: async () => {
    let session: SessionData;
    try {
      session = await loadSession();
    } catch {
      throw redirect({ to: "/login", search: { error: undefined } });
    }
    if (!session.google.connected) {
      throw redirect({ to: "/login", search: { error: undefined } });
    }
    return { session };
  },
  component: MobileCrm,
});

function MobileCrm() {
  const { session } = Route.useRouteContext();
  return <CrmDashboard initialSession={session} />;
}
