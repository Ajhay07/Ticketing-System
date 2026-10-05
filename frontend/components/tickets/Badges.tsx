import { AlertTriangle, Flame } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { statusLabel, type Priority, type TicketStatus } from "@/lib/tickets";

const PRIORITY_TONES: Record<Priority, BadgeTone> = {
  LOW: "slate",
  MEDIUM: "blue",
  HIGH: "orange",
  CRITICAL: "redSolid",
};

/** One distinct tone per lifecycle state (spec §34 "clear status badges"). */
const STATUS_TONES: Record<TicketStatus, BadgeTone> = {
  OPEN: "blue",
  TRIAGED: "indigo",
  ASSIGNED: "violet",
  IN_PROGRESS: "cyan",
  WAITING_FOR_CLIENT: "amber",
  RESOLVED: "green",
  CLOSED: "slate",
  REOPENED: "orange",
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  const critical = priority === "CRITICAL";
  return (
    <Badge
      tone={PRIORITY_TONES[priority]}
      dot={!critical}
      icon={critical ? <Flame className="h-3 w-3" aria-hidden /> : undefined}
      className={critical ? "font-semibold" : undefined}
    >
      {statusLabel(priority)}
    </Badge>
  );
}

export function StatusBadge({ status }: { status: TicketStatus }) {
  return (
    <Badge tone={STATUS_TONES[status] ?? "slate"} dot>
      {statusLabel(status)}
    </Badge>
  );
}

/** Due date cell: flagged in red with a warning icon when the API marks it overdue (spec §25). */
export function DueDate({ value, overdue }: { value: string; overdue?: boolean }) {
  if (!overdue) return <span className="tabular text-slate-500">{value}</span>;
  return (
    <span className="inline-flex items-center gap-1.5 font-medium tabular text-red-600" title="Overdue">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {value}
      <span className="sr-only">(overdue)</span>
    </span>
  );
}

/** Spec §25: overdue is a computed flag from the API (never auto-closed). */
export function OverdueBadge() {
  return (
    <Badge
      tone="red"
      icon={<AlertTriangle className="h-3 w-3" aria-hidden />}
      className="font-semibold uppercase tracking-wide"
    >
      Overdue
    </Badge>
  );
}
