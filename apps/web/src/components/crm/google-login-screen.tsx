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
    <main className="grid min-h-screen place-items-center bg-[#f5f7f6] px-5 py-10 text-[#17221d]">
      <section className="w-full max-w-sm rounded-3xl border border-black/[0.07] bg-white p-8 shadow-[0_24px_70px_rgba(24,48,36,0.12)] sm:p-10">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#183d2c] text-lg font-semibold text-white">
          S
        </div>
        <p className="mt-5 text-center text-sm font-semibold tracking-wide text-[#28613f]">
          SCCCI CRM
        </p>
        <h1 className="mt-2 text-center text-3xl font-semibold tracking-[-0.035em]">
          Sign in
        </h1>

        {errorMessage && (
          <div
            className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            role="alert"
          >
            {errorMessage}
          </div>
        )}

        <a
          href={googleSignInUrl()}
          className="mt-7 flex h-12 w-full items-center justify-center gap-3 rounded-xl bg-[#17221d] px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#244433] focus:outline-none focus:ring-2 focus:ring-[#77b891] focus:ring-offset-2"
        >
          <span className="grid h-6 w-6 place-items-center rounded-full bg-white text-xs font-bold text-[#4285f4]">
            G
          </span>
          Continue with Google
        </a>

        <div className="mt-6 flex items-start justify-center gap-2 text-xs leading-5 text-black/45">
          <LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Secure Google OAuth sign-in</span>
        </div>

        <div className="mt-5 text-center">
          <a
            href="/privacy-policy"
            className="text-xs font-semibold text-[#28613f] underline underline-offset-4"
          >
            Privacy policy
          </a>
        </div>
      </section>
    </main>
  );
}
