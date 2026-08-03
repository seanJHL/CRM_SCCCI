import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Database, LogOut, ShieldCheck, Trash2, Unplug } from "lucide-react";
import { api } from "@/lib/api";
import { type AuditLog, type PrivacySummary } from "@/lib/crm";
import { notify } from "@/components/mobile/notification-banner";
import { MobileCrmHeader } from "@/components/crm/mobile/mobile-crm-header";
import { MobileErrorState } from "@/components/mobile/error-state";

export const Route = createFileRoute("/m/crm/settings")({
  component: MobileCrmSettings,
});

const crmLayoutRoute = getRouteApi("/m/crm");

type AccountAction = "logout" | "disconnect" | "delete" | null;

function MobileCrmSettings() {
  const { session } = crmLayoutRoute.useRouteContext();
  const [timezone, setTimezone] = useState(session.user.timezone);
  const [workingHoursStart, setWorkingHoursStart] = useState(session.user.workingHoursStart);
  const [workingHoursEnd, setWorkingHoursEnd] = useState(session.user.workingHoursEnd);
  const [accountAction, setAccountAction] = useState<AccountAction>(null);

  const privacyQuery = useQuery({
    queryKey: ["crm", "privacy-summary"],
    queryFn: () => api.get<PrivacySummary>("/api/privacy/data-access"),
  });
  const auditQuery = useQuery({
    queryKey: ["crm", "audit"],
    queryFn: () => api.get<{ logs: AuditLog[] }>("/api/privacy/audit-logs?limit=20"),
  });

  const profileMutation = useMutation({
    mutationFn: (profile: { timezone: string; workingHoursStart: string; workingHoursEnd: string }) =>
      api.patch("/api/auth/me", profile),
    onSuccess: () => {
      notify({ title: "Preferences saved" });
    },
    onError: () => notify({ title: "Couldn't save preferences", body: "Try again in a moment." }),
  });
  const accountMutation = useMutation({
    mutationFn: async (action: Exclude<AccountAction, null>) => {
      if (action === "logout") return api.post("/api/auth/logout", {});
      if (action === "disconnect") return api.post("/api/auth/disconnect", {});
      return api.delete("/api/privacy/data", {});
    },
    onSuccess: () => {
      window.location.assign("/login");
    },
    onError: (_error, action) =>
      notify({
        title: `Couldn't ${action === "delete" ? "delete data" : action === "disconnect" ? "disconnect Google" : "log out"}`,
        body: "Try again in a moment.",
      }),
  });

  return (
    <div className="m-controller-page flex flex-col gap-4">
      <MobileCrmHeader title="Settings" backTo="/m/crm" />

      <section className="m-card space-y-3 p-4">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold text-[var(--m-text)]">
          <ShieldCheck width={15} height={15} /> Scheduling preferences
        </h2>
        <label className="block">
          <span className="mb-1.5 block text-[10px] font-semibold text-[var(--m-text-2)]">IANA timezone</span>
          <input value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="Asia/Singapore" className="m-field w-full" />
        </label>
        <div className="grid grid-cols-2 gap-2.5">
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-semibold text-[var(--m-text-2)]">Day starts</span>
            <input type="time" value={workingHoursStart} onChange={(event) => setWorkingHoursStart(event.target.value)} className="m-field w-full" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-semibold text-[var(--m-text-2)]">Day ends</span>
            <input type="time" value={workingHoursEnd} onChange={(event) => setWorkingHoursEnd(event.target.value)} className="m-field w-full" />
          </label>
        </div>
        <button
          type="button"
          onClick={() => profileMutation.mutate({ timezone, workingHoursStart, workingHoursEnd })}
          disabled={profileMutation.isPending}
          className="m-primary-button m-press w-full"
        >
          {profileMutation.isPending ? "Saving…" : "Save preferences"}
        </button>
      </section>

      <section className="m-card space-y-3 p-4">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold text-[var(--m-text)]">
          <Database width={15} height={15} /> Stored data
        </h2>
        {privacyQuery.isError ? (
          <MobileErrorState
            title="Couldn't load stored data"
            message="Try again in a moment."
            onRetry={() => void privacyQuery.refetch()}
          />
        ) : (
          privacyQuery.data && (
            <>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(privacyQuery.data.summary).map(([label, value]) => (
                  <div key={label} className="m-inset p-2.5">
                    <p className="text-[16px] font-semibold text-[var(--m-text)]">{value}</p>
                    <p className="mt-0.5 text-[9px] text-[var(--m-text-3)]">{label}</p>
                  </div>
                ))}
              </div>
              <p className="text-[11px] leading-5 text-[var(--m-text-2)]">{privacyQuery.data.description}</p>
            </>
          )
        )}
      </section>

      <section className="m-card space-y-2.5 p-4">
        <h2 className="text-[13px] font-semibold text-[var(--m-text)]">Recent audit activity</h2>
        {auditQuery.isError ? (
          <MobileErrorState
            title="Couldn't load audit activity"
            message="Try again in a moment."
            onRetry={() => void auditQuery.refetch()}
          />
        ) : auditQuery.data?.logs.length ? (
          <div className="space-y-1.5">
            {auditQuery.data.logs.map((log) => (
              <div key={log.id} className="m-inset flex items-center justify-between gap-2 px-2.5 py-2 text-[11px]">
                <span className="text-[var(--m-text-2)]">{log.action}</span>
                <time className="shrink-0 text-[var(--m-text-3)]">{formatDate(log.createdAt)}</time>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-[var(--m-text-3)]">No audit activity yet.</p>
        )}
      </section>

      <section className="m-card space-y-2.5 p-4">
        <h2 className="text-[13px] font-semibold text-[var(--m-text)]">Account controls</h2>
        <div className="grid gap-2">
          <button type="button" onClick={() => setAccountAction("logout")} className="m-secondary-button m-press justify-start gap-2 px-3">
            <LogOut width={15} height={15} /> Log out
          </button>
          <button type="button" onClick={() => setAccountAction("disconnect")} className="m-secondary-button m-press justify-start gap-2 px-3">
            <Unplug width={15} height={15} /> Disconnect Google
          </button>
          <button
            type="button"
            onClick={() => setAccountAction("delete")}
            className="m-press flex min-h-[50px] items-center justify-start gap-2 rounded-[14px] border border-[#ff765f]/40 bg-[#ff765f]/10 px-3 text-[13px] font-medium text-[#ff9a78]"
          >
            <Trash2 width={15} height={15} /> Delete all data
          </button>
        </div>
      </section>

      {accountAction && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 backdrop-blur-sm" onClick={() => setAccountAction(null)}>
          <div
            className="m-controller-surface w-full max-w-lg rounded-t-[26px] border border-b-0 border-[var(--m-border)] bg-[#20282d] p-5 pb-[max(20px,env(safe-area-inset-bottom))]"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-[18px] font-semibold text-[var(--m-text)]">
              {accountAction === "delete" ? "Delete all stored data?" : accountAction === "disconnect" ? "Disconnect Google?" : "Log out?"}
            </h3>
            <p className="mt-2 text-[12px] leading-5 text-[var(--m-text-2)]">
              {accountAction === "delete"
                ? "This revokes Google access and permanently deletes your profile, sessions, encrypted tokens, cached CRM records, bookings, and audit logs."
                : accountAction === "disconnect"
                  ? "Google access will be revoked, CRM cache cleared, and this session ended."
                  : "Your Google account stays connected; only this session ends."}
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2.5">
              <button type="button" onClick={() => setAccountAction(null)} className="m-secondary-button m-press">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => accountAction && accountMutation.mutate(accountAction)}
                disabled={accountMutation.isPending}
                className={
                  accountAction === "delete"
                    ? "m-press min-h-[50px] rounded-[14px] bg-[#ff765f] text-[13px] font-bold text-[#17110f] disabled:opacity-60"
                    : "m-primary-button m-press disabled:opacity-60"
                }
              >
                {accountMutation.isPending ? "Working…" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-SG", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(date);
}
