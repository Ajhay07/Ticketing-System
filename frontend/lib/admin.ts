import type { Role, Ticket } from "@/lib/tickets";

export type DashboardData = {
  metrics: {
    open: number;
    in_progress: number;
    waiting_for_client: number;
    overdue: number;
    resolved_today: number;
    unassigned: number;
  };
  priority_queue: { priority: Ticket["priority"]; count: number }[];
  recent_tickets: Ticket[];
};

export type WorkloadRow = {
  id: string;
  name: string;
  role: Role;
  open: number;
  in_progress: number;
  waiting_for_client: number;
  overdue: number;
  active_total: number;
};

export type ClientOrg = {
  id: string;
  name: string;
  slug: string;
  status: "ACTIVE" | "DISABLED";
  created_at: string;
  active_users: number;
  open: number;
  in_progress: number;
  waiting_for_client: number;
  overdue: number;
  resolved_this_month: number;
  total_tickets: number;
};

export type OrgUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: "ACTIVE" | "DISABLED";
  created_at: string;
};

export type ClientDetail = { organization: ClientOrg; users: OrgUser[]; recent_tickets: Ticket[] };

export type AuditEntry = {
  id: string;
  action: string;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  user_id: string | null;
  actor_name: string | null;
  ip_address: string | null;
  created_at: string;
};

export type Notification = {
  id: string;
  ticket_id: string | null;
  ticket_number: string | null;
  type: string;
  title: string;
  message: string;
  read_at: string | null;
  created_at: string;
};

export type ReportsData = {
  days: number;
  volume: Record<"day" | "week" | "month", { period: string; tickets: number }[]>;
  resolution: {
    avg_response_minutes: number | null;
    avg_resolution_minutes: number | null;
    tickets_resolved: number;
    tickets_reopened: number;
  };
  by_client: { id: string; name: string; total_tickets: number; open_tickets: number; overdue_tickets: number }[];
  by_team: {
    id: string;
    name: string;
    tickets_assigned: number;
    tickets_resolved: number;
    open_workload: number;
    avg_resolution_minutes: number | null;
  }[];
};

const ACTION_LABELS: Record<string, string> = {
  ticket_created: "Ticket created",
  ticket_assigned: "Assigned",
  ticket_reassigned: "Reassigned",
  status_changed: "Status changed",
  ticket_resolved: "Resolved",
  ticket_closed: "Closed",
  ticket_reopened: "Reopened",
  comment_added: "Reply added",
  internal_note_added: "Internal note added",
  attachment_added: "Attachment added",
  priority_changed: "Priority changed",
  ticket_updated: "Ticket updated",
  ticket_archived: "Ticket archived",
};

function pretty(value: unknown): string {
  return typeof value === "string" ? value.replace(/_/g, " ").toLowerCase() : "-";
}

/** Human-readable history line (spec §24 examples). */
export function describeAuditEntry(entry: Pick<AuditEntry, "action" | "old_value" | "new_value">): string {
  const label = ACTION_LABELS[entry.action] ?? entry.action.replace(/_/g, " ");
  const oldStatus = entry.old_value?.status;
  const newStatus = entry.new_value?.status;
  if (entry.action === "priority_changed") {
    return `${label}: ${pretty(entry.old_value?.priority)} → ${pretty(entry.new_value?.priority)}`;
  }
  if (typeof oldStatus === "string" && typeof newStatus === "string" && oldStatus !== newStatus) {
    return `${label}: ${pretty(oldStatus)} → ${pretty(newStatus)}`;
  }
  return label;
}

export function formatMinutes(minutes: number | null): string {
  if (minutes === null || minutes === undefined) return "-";
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return hours < 48 ? `${hours.toFixed(1)} h` : `${(hours / 24).toFixed(1)} d`;
}
