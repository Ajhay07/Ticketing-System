import { statusLabel, type Priority, type TicketStatus } from "@/lib/tickets";

const PRIORITY_CLASSES: Record<Priority, string> = {
  LOW: "bg-slate-100 text-slate-700",
  MEDIUM: "bg-blue-50 text-blue-700",
  HIGH: "bg-amber-50 text-amber-800",
  CRITICAL: "bg-red-50 text-red-700",
};

const STATUS_CLASSES: Partial<Record<TicketStatus, string>> = {
  RESOLVED: "bg-green-50 text-green-700",
  CLOSED: "bg-slate-100 text-slate-500",
  WAITING_FOR_CLIENT: "bg-amber-50 text-amber-800",
  REOPENED: "bg-red-50 text-red-700",
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${PRIORITY_CLASSES[priority]}`}>
      {statusLabel(priority)}
    </span>
  );
}

export function StatusBadge({ status }: { status: TicketStatus }) {
  return (
    <span
      className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_CLASSES[status] ?? "bg-slate-100 text-slate-700"}`}
    >
      {statusLabel(status)}
    </span>
  );
}
