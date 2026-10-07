"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { apiJson, statusLabel, type Me } from "@/lib/tickets";
import { cn } from "@/components/ui/cn";
import { buttonClasses } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/States";

/** Signs out via Supabase (clears the session cookies), drops cached data, and returns to /login. */
export function useLogout() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  async function logout() {
    setPending(true);
    try {
      await createSupabaseBrowserClient().auth.signOut();
    } finally {
      queryClient.clear();
      router.replace("/login");
      router.refresh();
    }
  }
  return { logout, pending };
}

function initials(email: string) {
  return email.slice(0, 2).toUpperCase();
}

/** Profile block pinned to the bottom of the sidebar. */
export function SidebarUser() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => apiJson<Me>("/api/me") });
  const { logout, pending } = useLogout();
  const email = me.data?.email ?? "";
  return (
    <div className="border-t border-cf-border px-4 py-4">
      <div className="flex items-center gap-3 px-2 py-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-cf-black text-xs font-bold text-white">
          {email ? initials(email) : ""}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-cf-ink" title={email}>
            {email || "Signed in"}
          </p>
          <p className="cf-label mt-0.5 truncate !text-[10px]">{me.data ? statusLabel(me.data.role) : " "}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={logout}
        disabled={pending}
        className={cn(buttonClasses("ghost", "md"), "mt-2 w-full justify-start px-2 text-cf-slate")}
      >
        {pending ? <Spinner /> : <LogOut className="h-4 w-4" />}
        Log out
      </button>
    </div>
  );
}

/** Compact log-out button for the client top bar. */
export function LogoutButton({ className }: { className?: string }) {
  const { logout, pending } = useLogout();
  return (
    <button
      type="button"
      onClick={logout}
      disabled={pending}
      className={cn(buttonClasses("ghost", "md"), className)}
      aria-label="Log out"
    >
      {pending ? <Spinner /> : <LogOut className="h-4 w-4" />}
      <span className="hidden md:inline">Log out</span>
    </button>
  );
}
