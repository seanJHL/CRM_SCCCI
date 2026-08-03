import { createFileRoute, redirect } from "@tanstack/react-router";
import { GoogleLoginScreen } from "@/components/crm/google-login-screen";
import { loadSession } from "@/lib/crm";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>) => ({
    error: typeof search.error === "string" ? search.error : undefined,
  }),
  beforeLoad: async () => {
    let authenticated = false;
    try {
      const session = await loadSession();
      authenticated = session.google.connected;
    } catch {
      // An unauthenticated response is expected on the login page.
    }
    if (authenticated) throw redirect({ to: "/crm" });
  },
  component: LoginPage,
});

function LoginPage() {
  const { error } = Route.useSearch();
  return <GoogleLoginScreen error={error} />;
}
