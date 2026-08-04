import { LockKeyhole } from "lucide-react";
import { googleSignInUrl } from "@/lib/crm";

interface GoogleLoginScreenProps {
  error?: string;
}

function getErrorMessage(error?: string) {
  if (!error) return null;
  if (error === "access_denied") {
    return "Google access was not approved. Nothing was connected.";
  }
  return "Google sign-in could not be completed. Please try again.";
}

export function GoogleLoginScreen({ error }: GoogleLoginScreenProps) {
  const errorMessage = getErrorMessage(error);

  return (
    <main
      className="grid min-h-dvh place-items-center bg-[#151b1f] px-5 text-[#f7f9f8]"
      style={{
        paddingTop: "max(2.5rem, calc(env(safe-area-inset-top, 0px) + 1.5rem))",
        paddingBottom: "max(2.5rem, calc(env(safe-area-inset-bottom, 0px) + 1.5rem))",
        paddingLeft: "max(1.25rem, env(safe-area-inset-left, 0px))",
        paddingRight: "max(1.25rem, env(safe-area-inset-right, 0px))",
      }}
    >
      <section className="w-full max-w-sm rounded-3xl border border-white/10 bg-[#20282d] p-8 shadow-[0_24px_70px_rgba(0,0,0,0.45)] sm:p-10">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#c6ff77] text-lg font-semibold text-[#14191d]">
          S
        </div>
        <p className="mt-5 text-center text-sm font-semibold tracking-wide text-[#c6ff77]">
          SCCCI CRM
        </p>
        <h1 className="mt-2 text-center text-3xl font-semibold tracking-[-0.035em] text-white">
          Sign in
        </h1>

        {errorMessage && (
          <div
            className="mt-6 rounded-xl border border-[#ff765f]/30 bg-[#ff765f]/10 px-4 py-3 text-sm text-[#ff9a78]"
            role="alert"
          >
            {errorMessage}
          </div>
        )}

        <a
          href={googleSignInUrl()}
          className="mt-7 flex h-12 w-full items-center justify-center gap-3 rounded-xl bg-[#c6ff77] px-5 text-sm font-semibold text-[#14191d] shadow-sm transition hover:bg-[#d5ffa0] focus:outline-none focus:ring-2 focus:ring-[#c6ff77] focus:ring-offset-2 focus:ring-offset-[#20282d]"
        >
          <span className="grid h-6 w-6 place-items-center rounded-full bg-white text-xs font-bold text-[#4285f4]">
            G
          </span>
          Continue with Google
        </a>

        <div className="mt-6 flex items-start justify-center gap-2 text-xs leading-5 text-white/45">
          <LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Secure Google OAuth sign-in</span>
        </div>

        <div className="mt-5 text-center">
          <a
            href="/privacy-policy"
            className="text-xs font-semibold text-white/60 underline underline-offset-4"
          >
            Privacy policy
          </a>
        </div>
      </section>
    </main>
  );
}
