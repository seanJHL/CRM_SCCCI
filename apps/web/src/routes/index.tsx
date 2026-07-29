import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys, type Company, type Contact, type Deal } from "@/lib/query-keys";

export const Route = createFileRoute("/")({
  component: DashboardPage,
});

function DashboardPage() {
  const { data: companies } = useQuery({
    queryKey: queryKeys.companies.all,
    queryFn: () => api.get<Company[]>("/api/companies"),
  });
  const { data: contacts } = useQuery({
    queryKey: queryKeys.contacts.all,
    queryFn: () => api.get<Contact[]>("/api/contacts"),
  });
  const { data: deals } = useQuery({
    queryKey: queryKeys.deals.all,
    queryFn: () => api.get<Deal[]>("/api/deals"),
  });

  const stats = [
    { label: "Companies", value: companies?.length ?? "—", color: "bg-brand-50 text-brand-700" },
    { label: "Contacts", value: contacts?.length ?? "—", color: "bg-green-50 text-green-700" },
    { label: "Active Deals", value: deals?.filter((d) => !["won", "lost"].includes(d.status)).length ?? "—", color: "bg-amber-50 text-amber-700" },
    { label: "Won Deals", value: deals?.filter((d) => d.status === "won").length ?? "—", color: "bg-purple-50 text-purple-700" },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">Overview of your CRM</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="card p-6">
            <div className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${stat.color}`}>
              {stat.label}
            </div>
            <p className="mt-3 text-3xl font-bold text-gray-900">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="card p-6">
        <h2 className="text-lg font-semibold text-gray-900">Recent Deals</h2>
        {deals && deals.length > 0 ? (
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-500">
                <th className="pb-2">Title</th>
                <th className="pb-2">Status</th>
                <th className="pb-2">Value</th>
                <th className="pb-2">Expected Close</th>
              </tr>
            </thead>
            <tbody>
              {deals.slice(0, 5).map((deal) => (
                <tr key={deal.id} className="table-row">
                  <td className="py-2 font-medium text-gray-900">{deal.title}</td>
                  <td className="py-2">
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs">{deal.status}</span>
                  </td>
                  <td className="py-2">{deal.value ?? "—"}</td>
                  <td className="py-2 text-gray-500">
                    {deal.expectedCloseDate
                      ? new Date(deal.expectedCloseDate).toLocaleDateString()
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mt-4 text-sm text-gray-500">No deals yet.</p>
        )}
      </div>
    </div>
  );
}
