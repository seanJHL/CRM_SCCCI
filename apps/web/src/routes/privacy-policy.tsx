import { createFileRoute } from "@tanstack/react-router";
import type React from "react";
import { ArrowLeft, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/privacy-policy")({
  component: PrivacyPolicyPage,
});

function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-[#f5f7f6] px-5 py-10 text-[#17221d] sm:px-8">
      <article className="mx-auto max-w-3xl rounded-[2rem] border border-black/[0.06] bg-white p-7 shadow-[0_24px_70px_rgba(24,48,36,0.08)] sm:p-12">
        <a href="/login" className="inline-flex items-center gap-2 text-sm font-medium text-black/45 hover:text-black">
          <ArrowLeft className="h-4 w-4" /> Back to sign in
        </a>
        <div className="mt-10 flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-[#e7f5eb] text-[#28613f]"><ShieldCheck className="h-5 w-5" /></span>
          <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#397454]">SCCCI CRM</p><h1 className="mt-1 text-3xl font-semibold tracking-[-0.04em]">Privacy policy</h1></div>
        </div>
        <p className="mt-8 text-sm leading-7 text-black/55">This policy explains how SCCCI CRM handles information received from Google APIs when you connect Gmail and Google Calendar. The application uses that data only to provide the user-facing CRM features you request.</p>

        <PolicySection title="Data the application accesses">
          The application accesses your verified Google identity, Gmail threads, Gmail sending capability, Google Calendar events, and free/busy availability. Participant availability is requested only when you enter participant email addresses and their calendars are available to you.
        </PolicySection>
        <PolicySection title="How the data is used">
          Gmail content is used to organise and classify conversations, explain priority, detect response and meeting intent, and prepare editable reply drafts. Calendar data is used to show upcoming meetings, detect conflicts, and recommend times. Email sending and calendar changes occur only after your explicit confirmation.
        </PolicySection>
        <PolicySection title="Storage and security">
          OAuth access and refresh tokens are encrypted at rest. Session credentials are kept in secure HttpOnly cookies and only keyed hashes are stored. Email bodies are fetched on demand and are not persisted; the CRM stores the minimum thread metadata, classifications, drafts, detected meeting requests, confirmed booking records, and PII-masked audit events needed to provide the service.
        </PolicySection>
        <PolicySection title="Sharing, AI, and model training">
          Connected Gmail and Calendar data is not sold, used for advertising, or shared with external AI providers. The current classification and drafting engine runs within the application using local rules. Google user data is not used to train AI models.
        </PolicySection>
        <PolicySection title="Retention and deletion">
          You can disconnect Google to revoke access and clear CRM records, or use “Delete all data” to remove your profile, all sessions, encrypted credentials, cached CRM records, bookings, and audit logs. Google data is otherwise retained only while needed to provide the connected service.
        </PolicySection>
        <PolicySection title="Google Limited Use disclosure">
          SCCCI CRM’s use and transfer of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.
        </PolicySection>
        <PolicySection title="Questions">
          Contact the administrator identified on the application’s Google OAuth consent screen for privacy questions or data requests.
        </PolicySection>

        <p className="mt-10 border-t border-black/[0.07] pt-6 text-xs text-black/35">Last updated: 2 August 2026</p>
      </article>
    </div>
  );
}

function PolicySection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="mt-8"><h2 className="text-base font-semibold">{title}</h2><p className="mt-2 text-sm leading-7 text-black/55">{children}</p></section>;
}
