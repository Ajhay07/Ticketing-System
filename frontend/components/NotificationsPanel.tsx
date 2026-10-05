"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellOff } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { cn } from "@/components/ui/cn";
import { EmptyState, LoadingState } from "@/components/ui/States";
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
    <Card className="mt-8">
      <CardHeader
        icon={<Bell className="h-4 w-4" />}
        title={
          <span className="flex items-center gap-2">
            Notifications
            {unread > 0 && (
              <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-2xs font-semibold leading-none text-white tabular">
                {unread}
              </span>
            )}
          </span>
        }
        actions={
          unread > 0 && (
            <Button variant="ghost" size="sm" onClick={() => markRead.mutate("/api/notifications/read-all")}>
              Mark all read
            </Button>
          )
        }
      />
      {data.isLoading && <LoadingState label="Loading notifications..." className="py-8" />}
      {!data.isLoading && items.length === 0 && (
        <EmptyState compact icon={BellOff} title="No notifications" description="You're all caught up." />
      )}
      {items.length > 0 && (
        <ul className="divide-y divide-slate-100">
          {items.map((n) => (
            <li key={n.id} className="flex items-start gap-3 px-5 py-3">
              <span
                className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-brand-600")}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className={cn("text-sm", n.read_at ? "text-slate-500" : "font-medium text-slate-900")}>
                  {n.ticket_id ? (
                    <Link
                      href={`${ticketBasePath}/${n.ticket_id}`}
                      className="rounded hover:text-brand-700 hover:underline"
                      onClick={() => {
                        if (!n.read_at) markRead.mutate(`/api/notifications/${n.id}/read`);
                      }}
                    >
                      {n.title}
                    </Link>
                  ) : (
                    n.title
                  )}
                </p>
                <p className="mt-0.5 text-xs text-slate-400">{formatDate(n.created_at)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
