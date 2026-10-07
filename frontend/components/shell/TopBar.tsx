"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bell, Search } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { apiJson, statusLabel, type Me } from "@/lib/tickets";
import type { Notification } from "@/lib/admin";

/**
 * Minimal desktop top bar: structured search (submits to the existing ticket
 * list search via ?q=), notification bell (existing notifications API, own
 * rows only via RLS), and the signed-in profile. Ctrl/Cmd+K focuses search.
 */
export function TopBar({ ticketsPath, dashboardPath }: { ticketsPath: string; dashboardPath: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [isMac, setIsMac] = useState(false);

  const me = useQuery({ queryKey: ["me"], queryFn: () => apiJson<Me>("/api/me") });
  const notifications = useQuery({
    queryKey: ["notifications"],
    queryFn: () => apiJson<{ items: Notification[]; unread: number }>("/api/notifications?limit=10"),
    refetchInterval: 60_000,
  });
  const unread = notifications.data?.unread ?? 0;
  const email = me.data?.email ?? "";

  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform));
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="sticky top-0 z-20 hidden h-16 items-center gap-6 border-b border-cf-border bg-white px-10 lg:flex">
      <form
        role="search"
        className="relative w-full max-w-md"
        onSubmit={(e) => {
          e.preventDefault();
          const q = value.trim();
          router.push(q ? `${ticketsPath}?q=${encodeURIComponent(q)}` : ticketsPath);
        }}
      >
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cf-muted" />
        <input
          ref={inputRef}
          type="search"
          aria-label="Search tickets"
          placeholder="Search tickets, clients, or team members..."
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="h-10 w-full rounded border border-cf-border-strong bg-white pl-9 pr-16 text-[13px] text-cf-ink placeholder:text-cf-muted transition-colors duration-150 hover:border-cf-slate focus:border-cf-ink focus:outline-none"
        />
        <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded-sm border border-cf-border px-1.5 py-0.5 font-sans text-[10px] font-semibold tracking-[0.06em] text-cf-slate">
          {isMac ? "⌘K" : "CTRL K"}
        </kbd>
      </form>

      <div className="ml-auto flex items-center gap-5">
        <Link
          href={dashboardPath}
          className="relative flex h-10 w-10 items-center justify-center rounded border border-transparent text-cf-ink transition-colors duration-150 hover:border-cf-border"
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        >
          <Bell className="h-[18px] w-[18px]" strokeWidth={1.75} />
          {unread > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center bg-cf-red px-1 text-[10px] font-bold leading-none text-white tabular">
              {unread}
            </span>
          )}
        </Link>
        <span className="h-8 w-px bg-cf-border" aria-hidden />
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded bg-cf-black text-xs font-bold text-white">
            {email ? email.slice(0, 2).toUpperCase() : ""}
          </span>
          <div className="hidden min-w-0 xl:block">
            <p className={cn("max-w-[200px] truncate text-[13px] font-semibold text-cf-ink")} title={email}>
              {email || " "}
            </p>
            <p className="cf-label !text-[10px]">{me.data ? statusLabel(me.data.role) : " "}</p>
          </div>
        </div>
      </div>
    </header>
  );
}
