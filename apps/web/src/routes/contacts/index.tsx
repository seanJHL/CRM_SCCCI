import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys, type Contact } from "@/lib/query-keys";

export const Route = createFileRoute("/contacts/")({
  component: ContactsPage,
});

function ContactsPage() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.contacts.all,
    queryFn: () => api.get<Contact[]>("/api/contacts"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/contacts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.contacts.all }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Contacts</h1>
          <p className="mt-1 text-sm text-gray-500">Manage your contact list</p>
        </div>
      </div>

      {error ? (
        <div className="card border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Error loading contacts: {error.message}
        </div>
      ) : null}

      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-500">Loading...</div>
        ) : data && data.length > 0 ? (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {data.map((contact) => (
                <tr key={contact.id} className="table-row">
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {contact.firstName} {contact.lastName}
                  </td>
                  <td className="px-4 py-3">{contact.title ?? "—"}</td>
                  <td className="px-4 py-3">{contact.email ?? "—"}</td>
                  <td className="px-4 py-3">{contact.phone ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        contact.isActive
                          ? "bg-green-50 text-green-700"
                          : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {contact.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => deleteMutation.mutate(contact.id)}
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
            No contacts yet. Create one to get started.
          </div>
        )}
      </div>
    </div>
  );
}
