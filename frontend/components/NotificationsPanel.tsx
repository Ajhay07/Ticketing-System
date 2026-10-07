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
export function NotificationsPanel({
  ticketBasePath,
  title = "Notifications",
  className,
}: {
  ticketBasePath: string;
  title?: string;
  className?: string;
}) {
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
    <Card className={cn("mt-10", className)}>
      <CardHeader
        icon={<Bell className="h-4 w-4" />}
        title={
          <span className="flex items-center gap-2">
            {title}
            {unread > 0 && (
              <span className="bg-cf-red px-1.5 py-0.5 text-[10px] font-bold leading-none tracking-normal text-white tabular">
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
        <ol className="relative px-5 py-4">
          <span className="absolute bottom-6 left-[25px] top-6 w-px bg-cf-border" aria-hidden />
          {items.map((n) => (
            <li key={n.id} className="relative flex items-start gap-4 py-3">
              <span
                className={cn(
                  "relative z-10 mt-1 h-2.5 w-2.5 shrink-0 rounded-full border-2",
                  n.read_at ? "border-cf-border-strong bg-white" : "border-cf-black bg-cf-black"
                )}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className={cn("text-sm", n.read_at ? "text-cf-slate" : "font-semibold text-cf-ink")}>
                  {n.ticket_id ? (
                    <Link
                      href={`${ticketBasePath}/${n.ticket_id}`}
                      className="rounded-sm underline-offset-4 hover:underline"
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
                <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-cf-muted tabular">{formatDate(n.created_at)}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
