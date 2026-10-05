"use client";

import Link from "next/link";
import { use, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PriorityBadge, StatusBadge } from "@/components/tickets/Badges";
import type { ClientDetail, OrgUser } from "@/lib/admin";
import { apiJson, formatDate, statusLabel } from "@/lib/tickets";

/** Client detail (spec §38) + client user management (spec §18, decision #7). */
export default function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: ["client", id],
    queryFn: () => apiJson<ClientDetail>(`/api/admin/clients/${id}`),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["client", id] });

  const toggleOrg = useMutation({
    mutationFn: (status: "ACTIVE" | "DISABLED") =>
      apiJson(`/api/admin/clients/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
    onSuccess: refresh,
  });

  if (detail.error) {
    return <main className="mx-auto max-w-6xl p-8 text-sm text-red-600">{(detail.error as Error).message}</main>;
  }
  if (!detail.data) return <main className="mx-auto max-w-6xl p-8 text-sm text-slate-500">Loading...</main>;
  const { organization: org, users, recent_tickets } = detail.data;
  const stats = [
    ["Active Users", org.active_users],
    ["Open Tickets", org.open],
    ["In Progress", org.in_progress],
    ["Overdue", org.overdue],
    ["Resolved This Month", org.resolved_this_month],
  ] as const;

  return (
    <main className="mx-auto max-w-6xl p-8">
      <Link href="/admin/clients" className="text-sm text-slate-500 underline">
        Back to clients
      </Link>
      <div className="mt-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">{org.name}</h1>
        <button
          type="button"
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          onClick={() => toggleOrg.mutate(org.status === "ACTIVE" ? "DISABLED" : "ACTIVE")}
        >
          {org.status === "ACTIVE" ? "Disable client" : "Enable client"}
        </button>
      </div>
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {stats.map(([label, value]) => (
          <div key={label} className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-xs uppercase text-slate-500">{label}</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
          </div>
        ))}
      </div>

      <h2 className="mt-8 text-lg font-semibold text-slate-900">Users</h2>
      <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <tbody>
            {users.map((u) => (
              <UserRow key={u.id} user={u} onChanged={refresh} />
            ))}
          </tbody>
        </table>
        {users.length === 0 && <p className="p-4 text-sm text-slate-500">No users yet.</p>}
      </div>
      <AddUserForm organizationId={id} onAdded={refresh} />

      <h2 className="mt-8 text-lg font-semibold text-slate-900">Ticket History</h2>
      <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <tbody>
            {recent_tickets.map((t) => (
              <tr key={t.id} className="border-b border-slate-100 last:border-0">
                <td className="px-3 py-2 font-mono text-xs">
                  <Link href={`/admin/tickets/${t.id}`}>{t.ticket_number}</Link>
                </td>
                <td className="px-3 py-2">{t.subject}</td>
                <td className="px-3 py-2">
                  <PriorityBadge priority={t.priority} />
                </td>
                <td className="px-3 py-2">
                  <StatusBadge status={t.status} />
                </td>
                <td className="px-3 py-2 text-slate-500">{formatDate(t.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {recent_tickets.length === 0 && <p className="p-4 text-sm text-slate-500">No tickets yet.</p>}
      </div>
    </main>
  );
}

function UserRow({ user, onChanged }: { user: OrgUser; onChanged: () => void }) {
  const [message, setMessage] = useState("");
  const act = useMutation({
    mutationFn: (path: string) => apiJson(`/api/admin/users/${user.id}/${path}`, { method: "POST" }),
    onSuccess: (_data, path) => {
      setMessage(path === "reset-access" ? "Reset email sent" : "");
      onChanged();
    },
    onError: (err) => setMessage((err as Error).message),
  });
  const changeRole = useMutation({
    mutationFn: (role: string) =>
      apiJson(`/api/admin/users/${user.id}`, { method: "PATCH", body: JSON.stringify({ role }) }),
    onSuccess: onChanged,
    onError: (err) => setMessage((err as Error).message),
  });
  return (
    <tr className="border-b border-slate-100 last:border-0">
      <td className="px-3 py-2 font-medium text-slate-900">{user.name}</td>
      <td className="px-3 py-2 text-slate-600">{user.email}</td>
      <td className="px-3 py-2">
        <select
          aria-label={`Role for ${user.email}`}
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
          value={user.role}
          onChange={(e) => changeRole.mutate(e.target.value)}
        >
          <option value="CLIENT_ADMIN">{statusLabel("CLIENT_ADMIN")}</option>
          <option value="CLIENT_USER">{statusLabel("CLIENT_USER")}</option>
        </select>
      </td>
      <td className="px-3 py-2 text-slate-600">{user.status}</td>
      <td className="px-3 py-2">
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-md border border-slate-300 px-2 py-1 text-xs"
            onClick={() => {
              const disabling = user.status === "ACTIVE";
              if (!disabling || window.confirm(`Disable ${user.email}? They will no longer be able to sign in.`)) {
                act.mutate(disabling ? "disable" : "enable");
              }
            }}
          >
            {user.status === "ACTIVE" ? "Disable / Remove" : "Enable"}
          </button>
          <button
            type="button"
            className="rounded-md border border-slate-300 px-2 py-1 text-xs"
            onClick={() => act.mutate("reset-access")}
          >
            Reset access
          </button>
        </div>
        {message && <p className="mt-1 text-xs text-slate-600">{message}</p>}
      </td>
    </tr>
  );
}

function AddUserForm({ organizationId, onAdded }: { organizationId: string; onAdded: () => void }) {
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "CLIENT_USER" });
  const add = useMutation({
    mutationFn: () =>
      apiJson("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({ ...form, organization_id: organizationId }),
      }),
    onSuccess: () => {
      setForm({ name: "", email: "", password: "", role: "CLIENT_USER" });
      onAdded();
    },
  });
  const input = "rounded-md border border-slate-300 px-2 py-1.5 text-sm";
  return (
    <form
      className="mt-3 flex flex-wrap gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        add.mutate();
      }}
    >
      <input aria-label="Name" placeholder="Name" className={input} value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })} required />
      <input aria-label="Email" type="email" placeholder="Email" className={input} value={form.email}
        onChange={(e) => setForm({ ...form, email: e.target.value })} required />
      <input aria-label="Temporary password" type="password" placeholder="Temporary password (8+)" minLength={8}
        className={input} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
      <select aria-label="Role" className={input} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
        <option value="CLIENT_USER">Client User</option>
        <option value="CLIENT_ADMIN">Client Admin</option>
      </select>
      <button type="submit" disabled={add.isPending}
        className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
        Add user
      </button>
      {add.error && <p className="w-full text-sm text-red-600">{(add.error as Error).message}</p>}
    </form>
  );
}
