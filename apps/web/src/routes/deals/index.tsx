import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys, type Deal, DEAL_STATUSES } from "@/lib/query-keys";

export const Route = createFileRoute("/deals/")({
  component: DealsPage,
});

const statusColors: Record<string, string> = {
  lead: "bg-blue-50 text-blue-700",
  qualified: "bg-indigo-50 text-indigo-700",
  proposal: "bg-amber-50 text-amber-700",
  negotiation: "bg-orange-50 text-orange-700",
  won: "bg-green-50 text-green-700",
  lost: "bg-red-50 text-red-700",
};

function DealsPage() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.deals.all,
    queryFn: () => api.get<Deal[]>("/api/deals"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/deals/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.deals.all }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Deals</h1>
          <p className="mt-1 text-sm text-gray-500">Track your sales pipeline</p>
        </div>
      </div>

      {error ? (
        <div className="card border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Error loading deals: {error.message}
        </div>
      ) : null}

      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-500">Loading...</div>
        ) : data && data.length > 0 ? (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-500">
              <tr>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Value</th>
                <th className="px-4 py-3">Expected Close</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {data.map((deal) => (
                <tr key={deal.id} className="table-row">
                  <td className="px-4 py-3 font-medium text-gray-900">{deal.title}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        statusColors[deal.status] ?? "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {deal.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">{deal.value ?? "—"}</td>
                  <td className="px-4 py-3 text-gray-500">
                    {deal.expectedCloseDate
                      ? new Date(deal.expectedCloseDate).toLocaleDateString()
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => deleteMutation.mutate(deal.id)}
                      className="text-xs text-red-500 hover:underline"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="p-8 text-center text-gray-500">
            No deals yet. Create one to get started.
          </div>
        )}
      </div>

      {/* Deal status legend */}
      <div className="flex flex-wrap gap-2">
        {DEAL_STATUSES.map((status) => (
          <span
            key={status}
            className={`rounded-full px-3 py-1 text-xs font-medium capitalize ${
              statusColors[status] ?? "bg-gray-100 text-gray-500"
            }`}
          >
            {status}
          </span>
        ))}
      </div>
    </div>
  );
}
