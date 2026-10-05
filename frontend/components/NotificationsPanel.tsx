"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiJson, formatDate } from "@/lib/tickets";
import type { Notification } from "@/lib/admin";

/** In-app notifications (spec §26). Only the caller's own rows are returned (RLS). */
export function NotificationsPanel({ ticketBasePath }: { ticketBasePath: string }) {
  const queryClient = useQueryClient();
  const data = useQuery({
    queryKey: ["notifications"],
    queryFn: () => apiJson<{ items: Notification[]; unread: number }>("/api/notifications?limit=10"),
    refetchInterval: 60_000,
  });
  const markRead = useMutation({
    mutationFn: (path: string) => apiJson<null>(path, { method: "POST" }).catch(() => null),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });
  const items = data.data?.items ?? [];
  const unread = data.data?.unread ?? 0;
  return (
    <section className="mt-8 rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-900">
          Notifications {unread > 0 && <span className="text-red-600">({unread})</span>}
        </h2>
        {unread > 0 && (
          <button
            type="button"
            className="text-sm text-slate-600 underline"
            onClick={() => markRead.mutate("/api/notifications/read-all")}
          >
            Mark all read
          </button>
        )}
      </div>
      {items.length === 0 && <p className="mt-2 text-sm text-slate-500">No notifications.</p>}
      <ul className="mt-3 space-y-2 text-sm">
        {items.map((n) => (
          <li key={n.id} className={n.read_at ? "text-slate-500" : "font-medium text-slate-900"}>
            {n.ticket_id ? (
              <Link
                href={`${ticketBasePath}/${n.ticket_id}`}
                onClick={() => {
                  if (!n.read_at) markRead.mutate(`/api/notifications/${n.id}/read`);
                }}
              >
                {n.title}
              </Link>
            ) : (
              n.title
            )}
            <span className="ml-2 text-xs text-slate-400">{formatDate(n.created_at)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
