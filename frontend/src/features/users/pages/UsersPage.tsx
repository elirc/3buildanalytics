import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { createUser, getUsers, updateUser, type AdminUser } from "../../../api/users.api";
import { useAuthStore, type Role } from "../../../auth/auth.store";
import { ConfirmDialog } from "../../../components/ConfirmDialog";
import { Pagination } from "../../../components/Pagination";
import { QueryBoundary } from "../../../components/QueryBoundary";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { formatDate } from "../../../lib/formatDate";
import { useDashboardFilters } from "../../dashboard/hooks/useDashboardFilters";

const ROLES: Role[] = [
  "SYSTEM_ADMIN",
  "OPS_MANAGER",
  "PRODUCT_MANAGER",
  "ENGINEERING_ADMIN",
  "AUDIT_VIEWER",
  "EXECUTIVE_VIEWER",
  "READ_ONLY"
];

export function UsersPage() {
  const { filters, updateFilters } = useDashboardFilters();
  const queryClient = useQueryClient();
  const currentUserId = useAuthStore((state) => state.user?.id);

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [pendingDeactivation, setPendingDeactivation] = useState<AdminUser | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    email: "",
    password: "",
    firstName: "",
    lastName: "",
    role: "READ_ONLY" as Role
  });

  const usersQuery = useQuery({
    queryKey: ["users", filters.page, filters.pageSize, search, roleFilter],
    queryFn: () =>
      getUsers({
        page: filters.page,
        pageSize: filters.pageSize,
        search: search || undefined,
        role: roleFilter || undefined
      })
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["users"] });

  const createMutation = useMutation({
    mutationFn: createUser,
    onSuccess: () => {
      setDraft({ email: "", password: "", firstName: "", lastName: "", role: "READ_ONLY" });
      setFormError(null);
      invalidate();
    },
    onError: (error: Error) => setFormError(error.message)
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Parameters<typeof updateUser>[1] }) =>
      updateUser(id, payload),
    onSuccess: () => {
      setFormError(null);
      invalidate();
    },
    // The server owns rules the client cannot fully know — last-admin, for one —
    // so a rejection is surfaced rather than guessed at up front.
    onError: (error: Error) => setFormError(error.message)
  });

  return (
    <div className="space-y-6">
      <Card className="space-y-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Administration</p>
          <h2 className="mt-1 text-xl font-semibold">Users</h2>
        </div>

        <div className="flex flex-wrap gap-3">
          <input
            aria-label="Search users"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              updateFilters({ page: 1 });
            }}
            placeholder="Search name or email"
            className="rounded-2xl border border-[var(--border)] bg-white px-4 py-3 text-sm"
          />
          <select
            aria-label="Filter by role"
            value={roleFilter}
            onChange={(event) => {
              setRoleFilter(event.target.value);
              updateFilters({ page: 1 });
            }}
            className="rounded-2xl border border-[var(--border)] bg-white px-4 py-3 text-sm"
          >
            <option value="">All roles</option>
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </div>
      </Card>

      <Card className="space-y-3">
        <h3 className="text-lg font-semibold">Invite a user</h3>
        <div className="grid gap-3 md:grid-cols-2">
          <input
            aria-label="Email"
            value={draft.email}
            onChange={(event) => setDraft({ ...draft, email: event.target.value })}
            placeholder="Email"
            className="rounded-2xl border border-[var(--border)] bg-white px-4 py-3 text-sm"
          />
          <input
            aria-label="Temporary password"
            type="password"
            value={draft.password}
            onChange={(event) => setDraft({ ...draft, password: event.target.value })}
            placeholder="Temporary password"
            className="rounded-2xl border border-[var(--border)] bg-white px-4 py-3 text-sm"
          />
          <input
            aria-label="First name"
            value={draft.firstName}
            onChange={(event) => setDraft({ ...draft, firstName: event.target.value })}
            placeholder="First name"
            className="rounded-2xl border border-[var(--border)] bg-white px-4 py-3 text-sm"
          />
          <input
            aria-label="Last name"
            value={draft.lastName}
            onChange={(event) => setDraft({ ...draft, lastName: event.target.value })}
            placeholder="Last name"
            className="rounded-2xl border border-[var(--border)] bg-white px-4 py-3 text-sm"
          />
          <select
            aria-label="Role"
            value={draft.role}
            onChange={(event) => setDraft({ ...draft, role: event.target.value as Role })}
            className="rounded-2xl border border-[var(--border)] bg-white px-4 py-3 text-sm"
          >
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </div>
        {formError ? <p className="text-sm text-[var(--danger)]">{formError}</p> : null}
        <Button onClick={() => createMutation.mutate(draft)} disabled={createMutation.isPending}>
          {createMutation.isPending ? "Creating..." : "Create user"}
        </Button>
      </Card>

      <QueryBoundary
        query={usersQuery}
        loadingLabel="Loading users..."
        emptyMessage="No users match these filters."
        isEmpty={(data) => data.items.length === 0}
      >
        {(data) => (
          <div className="space-y-4">
            <div className="overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface)]">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-[var(--surface-2)] text-[var(--muted)]">
                  <tr>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Email</th>
                    <th className="px-4 py-3">Role</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Created</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((user) => {
                    const isSelf = user.id === currentUserId;

                    return (
                      <tr key={user.id} className="border-t border-[var(--border)]">
                        <td className="px-4 py-3">
                          {user.firstName} {user.lastName}
                          {isSelf ? <span className="ml-2 text-xs text-[var(--muted)]">(you)</span> : null}
                        </td>
                        <td className="px-4 py-3">{user.email}</td>
                        <td className="px-4 py-3">
                          <select
                            aria-label={`Role for ${user.email}`}
                            value={user.role}
                            // Self-role changes are refused by the server; disabling
                            // the control says so before the user tries.
                            disabled={isSelf || updateMutation.isPending}
                            onChange={(event) =>
                              updateMutation.mutate({
                                id: user.id,
                                payload: { role: event.target.value as Role }
                              })
                            }
                            className="rounded-2xl border border-[var(--border)] bg-white px-3 py-2 disabled:opacity-50"
                          >
                            {ROLES.map((role) => (
                              <option key={role} value={role}>
                                {role}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-3">{user.isActive ? "Active" : "Inactive"}</td>
                        <td className="px-4 py-3">{formatDate(user.createdAt)}</td>
                        <td className="px-4 py-3">
                          {user.isActive ? (
                            <button
                              type="button"
                              disabled={isSelf}
                              onClick={() => setPendingDeactivation(user)}
                              className="font-medium text-[var(--danger)] disabled:opacity-40"
                            >
                              Deactivate
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() =>
                                updateMutation.mutate({ id: user.id, payload: { isActive: true } })
                              }
                              className="font-medium text-[var(--primary)]"
                            >
                              Reactivate
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <Pagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              pageCount={data.pageCount}
              onPageChange={(page) => updateFilters({ page })}
              onPageSizeChange={(pageSize) => updateFilters({ pageSize })}
            />
          </div>
        )}
      </QueryBoundary>

      <ConfirmDialog
        open={pendingDeactivation !== null}
        title="Deactivate this user?"
        // Naming the account is the difference between a confirmation and a
        // reflex click.
        message={
          pendingDeactivation
            ? `${pendingDeactivation.firstName} ${pendingDeactivation.lastName} (${pendingDeactivation.email}) will be signed out everywhere and unable to log in.`
            : ""
        }
        confirmLabel="Deactivate"
        onCancel={() => setPendingDeactivation(null)}
        onConfirm={() => {
          if (pendingDeactivation) {
            updateMutation.mutate({ id: pendingDeactivation.id, payload: { isActive: false } });
          }
          setPendingDeactivation(null);
        }}
      />
    </div>
  );
}
