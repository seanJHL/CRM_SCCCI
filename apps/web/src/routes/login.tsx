import { createFileRoute, redirect } from "@tanstack/react-router";
import type React from "react";
import {
  CalendarDays,
  Check,
  LockKeyhole,
  Mail,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { googleSignInUrl, loadSession } from "@/lib/crm";

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
  const errorMessage = error
    ? error === "access_denied"
      ? "Google access was not approved. Nothing was connected."
      : "Google sign-in could not be completed. Please try again."
    : null;

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#f5f7f6] px-5 py-8 text-[#17221d] sm:px-8">
      <div className="pointer-events-none absolute -left-28 -top-28 h-96 w-96 rounded-full bg-[#dff4e7] blur-3xl" />
      <div className="pointer-events-none absolute -bottom-36 -right-20 h-[28rem] w-[28rem] rounded-full bg-[#e7ecff] blur-3xl" />

      <div className="relative mx-auto flex min-h-[calc(100vh-4rem)] max-w-6xl items-center">
        <div className="grid w-full overflow-hidden rounded-[2rem] border border-black/5 bg-white shadow-[0_30px_90px_rgba(24,48,36,0.12)] lg:grid-cols-[1.05fr_0.95fr]">
          <section className="flex flex-col justify-between bg-[#183d2c] p-8 text-white sm:p-12 lg:min-h-[680px]">
            <div>
              <div className="flex items-center gap-3 text-sm font-semibold tracking-wide">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#b7f1cc] text-[#123624]">
                  S
                </span>
                SCCCI CRM
              </div>
              <h1 className="mt-16 max-w-xl text-4xl font-semibold leading-[1.08] tracking-[-0.045em] sm:text-6xl">
                Your inbox and calendar, finally in one calm place.
              </h1>
              <p className="mt-6 max-w-lg text-base leading-7 text-white/65">
                Triage conversations, prepare replies, and find meeting times while keeping every send and booking under your control.
              </p>
            </div>

            <div className="mt-12 grid gap-3 sm:grid-cols-3">
              <Feature icon={Mail} label="Gmail triage" />
              <Feature icon={CalendarDays} label="Smart scheduling" />
              <Feature icon={ShieldCheck} label="Review first" />
            </div>
          </section>

          <section className="flex flex-col justify-center p-8 sm:p-12 lg:p-16">
            <div className="mx-auto w-full max-w-md">
              <div className="inline-flex items-center gap-2 rounded-full bg-[#edf7f0] px-3 py-1.5 text-xs font-semibold text-[#28613f]">
                <Sparkles className="h-3.5 w-3.5" />
                Private by design
              </div>
              <h2 className="mt-6 text-3xl font-semibold tracking-[-0.035em]">
                Continue with Google
              </h2>
              <p className="mt-3 text-sm leading-6 text-black/55">
                Sign in is required before the CRM or connected data can be accessed.
              </p>

              {errorMessage && (
                <div className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
                  {errorMessage}
                </div>
              )}

              <a
                href={googleSignInUrl()}
                className="mt-7 flex h-12 w-full items-center justify-center gap-3 rounded-xl bg-[#17221d] px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#244433] focus:outline-none focus:ring-2 focus:ring-[#77b891] focus:ring-offset-2"
              >
                <span className="grid h-6 w-6 place-items-center rounded-full bg-white text-xs font-bold text-[#4285f4]">G</span>
                Sign in and connect Google
              </a>

              <div className="mt-8 space-y-4 rounded-2xl border border-black/[0.07] bg-[#fafbf9] p-5">
                <Permission text="Read Gmail threads for classification and reply context" />
                <Permission text="Send only replies you explicitly confirm" />
                <Permission text="Read availability and manage events you confirm" />
              </div>

              <div className="mt-6 flex items-start gap-3 text-xs leading-5 text-black/45">
                <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  OAuth tokens are encrypted at rest. Email bodies are fetched on demand and are not stored. No Gmail or Calendar data is sent to an external AI service or used to train models. Our use of Google Workspace data follows the Google API Services User Data Policy, including Limited Use requirements.
                </p>
              </div>
              <a href="/privacy-policy" className="mt-5 inline-block text-xs font-semibold text-[#28613f] underline underline-offset-4">
                Read the privacy policy
              </a>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function Feature({
  icon: Icon,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.07] p-4">
      <Icon className="h-5 w-5 text-[#b7f1cc]" />
      <p className="mt-4 text-sm font-medium">{label}</p>
    </div>
  );
}

function Permission({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-3 text-sm text-black/65">
      <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#dff4e7] text-[#24633d]">
        <Check className="h-3 w-3" strokeWidth={3} />
      </span>
      <span>{text}</span>
    </div>
  );
}
