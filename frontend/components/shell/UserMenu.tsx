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
    <div className="border-t border-slate-200 p-3">
      <div className="flex items-center gap-3 rounded-md px-2 py-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
          {email ? initials(email) : ""}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-900" title={email}>
            {email || "Signed in"}
          </p>
          <p className="truncate text-xs text-slate-500">{me.data ? statusLabel(me.data.role) : " "}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={logout}
        disabled={pending}
        className={cn(buttonClasses("ghost", "md"), "mt-1 w-full justify-start px-2 text-slate-600")}
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
