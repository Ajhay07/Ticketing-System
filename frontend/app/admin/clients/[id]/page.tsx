"use client";

import Link from "next/link";
import { use, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, CheckCircle2, CircleDot, Clock, Ticket as TicketIcon, UserPlus, Users } from "lucide-react";
import { PriorityBadge, StatusBadge } from "@/components/tickets/Badges";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, Page, PageHeader } from "@/components/ui/Card";
import { ErrorText, Input, Select } from "@/components/ui/Form";
import { StatCard } from "@/components/ui/StatCard";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/States";
import { Table, TBody, TD, TH, THead, TicketNumberLink, TR } from "@/components/ui/Table";
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

  const back = (
    <Link
      href="/admin/clients"
      className="mb-4 inline-flex items-center gap-1.5 rounded text-sm font-medium text-slate-500 hover:text-slate-900"
    >
      <ArrowLeft className="h-4 w-4" />
      Back to clients
    </Link>
  );

  if (detail.error) {
    return (
      <Page>
        {back}
        <ErrorState message="We couldn't load this client." onRetry={() => detail.refetch()} />
      </Page>
    );
  }
  if (!detail.data) {
    return (
      <Page>
        {back}
        <LoadingState label="Loading client..." />
      </Page>
    );
  }
  const { organization: org, users, recent_tickets } = detail.data;
  const active = org.status === "ACTIVE";

  return (
    <Page>
      {back}
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {org.name}
            <Badge tone={active ? "green" : "slate"} dot>
              {active ? "Active" : "Disabled"}
            </Badge>
          </span>
        }
        actions={
          <Button
            variant={active ? "destructive" : "secondary"}
            disabled={toggleOrg.isPending}
            onClick={() => toggleOrg.mutate(active ? "DISABLED" : "ACTIVE")}
          >
            {active ? "Disable client" : "Enable client"}
          </Button>
        }
      />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Active Users" value={org.active_users} icon={Users} />
        <StatCard label="Open Tickets" value={org.open} icon={CircleDot} tone="brand" />
        <StatCard label="In Progress" value={org.in_progress} icon={Clock} tone="brand" />
        <StatCard label="Overdue" value={org.overdue} icon={AlertTriangle} alert={org.overdue > 0} />
        <StatCard label="Resolved This Month" value={org.resolved_this_month} icon={CheckCircle2} tone="success" />
      </div>

      <Card className="mt-8">
        <CardHeader icon={<Users className="h-4 w-4" />} title="Users" description="People who can sign in for this client." />
        {users.length === 0 ? (
          <EmptyState compact icon={Users} title="No users yet" description="Add the first user below." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <tr>
                  <TH>Name</TH>
                  <TH>Email</TH>
                  <TH>Role</TH>
                  <TH>Status</TH>
                  <TH>Actions</TH>
                </tr>
              </THead>
              <TBody>
                {users.map((u) => (
                  <UserRow key={u.id} user={u} onChanged={refresh} />
                ))}
              </TBody>
            </Table>
          </div>
        )}
        <AddUserForm organizationId={id} onAdded={refresh} />
      </Card>

      <Card className="mt-8">
        <CardHeader icon={<TicketIcon className="h-4 w-4" />} title="Ticket History" />
        {recent_tickets.length === 0 ? (
          <EmptyState compact icon={TicketIcon} title="No tickets yet" />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <tr>
                  <TH>Ticket</TH>
                  <TH>Subject</TH>
                  <TH>Priority</TH>
                  <TH>Status</TH>
                  <TH>Created</TH>
                </tr>
              </THead>
              <TBody>
                {recent_tickets.map((t) => (
                  <TR key={t.id} href={`/admin/tickets/${t.id}`}>
                    <TD>
                      <TicketNumberLink href={`/admin/tickets/${t.id}`}>{t.ticket_number}</TicketNumberLink>
                    </TD>
                    <TD className="max-w-[320px] truncate font-medium text-slate-900">{t.subject}</TD>
                    <TD>
                      <PriorityBadge priority={t.priority} />
                    </TD>
                    <TD>
                      <StatusBadge status={t.status} />
                    </TD>
                    <TD className="tabular text-slate-500">{formatDate(t.created_at)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </Card>
    </Page>
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
  const active = user.status === "ACTIVE";
  return (
    <tr className="hover:bg-slate-50/80">
      <TD className="font-medium text-slate-900">{user.name}</TD>
      <TD className="text-slate-600">{user.email}</TD>
      <TD>
        <Select
          aria-label={`Role for ${user.email}`}
          className="h-8 w-36 text-xs"
          value={user.role}
          onChange={(e) => changeRole.mutate(e.target.value)}
        >
          <option value="CLIENT_ADMIN">{statusLabel("CLIENT_ADMIN")}</option>
          <option value="CLIENT_USER">{statusLabel("CLIENT_USER")}</option>
        </Select>
      </TD>
      <TD>
        <Badge tone={active ? "green" : "slate"} dot>
          {active ? "Active" : statusLabel(user.status)}
        </Badge>
      </TD>
      <TD>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={active ? "destructive" : "secondary"}
            onClick={() => {
              const disabling = user.status === "ACTIVE";
              if (!disabling || window.confirm(`Disable ${user.email}? They will no longer be able to sign in.`)) {
                act.mutate(disabling ? "disable" : "enable");
              }
            }}
          >
            {active ? "Disable / Remove" : "Enable"}
          </Button>
          <Button size="sm" onClick={() => act.mutate("reset-access")}>
            Reset access
          </Button>
        </div>
        {message && <p className="mt-1 text-xs text-slate-600">{message}</p>}
      </TD>
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
  return (
    <form
      className="border-t border-slate-100 bg-slate-50/60 px-5 py-4"
      onSubmit={(e) => {
        e.preventDefault();
        add.mutate();
      }}
    >
      <p className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-700">
        <UserPlus className="h-4 w-4 text-slate-400" />
        Add a user
      </p>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_160px_auto]">
        <Input aria-label="Name" placeholder="Name" value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <Input aria-label="Email" type="email" placeholder="Email" value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        <Input aria-label="Temporary password" type="password" placeholder="Temporary password (8+)" minLength={8}
          autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
        <Select aria-label="Role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
          <option value="CLIENT_USER">Client User</option>
          <option value="CLIENT_ADMIN">Client Admin</option>
        </Select>
        <Button type="submit" variant="primary" disabled={add.isPending}>
          Add user
        </Button>
      </div>
      {add.error && <ErrorText className="mt-3">{(add.error as Error).message}</ErrorText>}
    </form>
  );
}
