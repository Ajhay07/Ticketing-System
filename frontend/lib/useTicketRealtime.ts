"use client";

import { useEffect, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { CommentRow } from "@/lib/chat";

export type RealtimeState = "connecting" | "live" | "down";

/**
 * Live ticket_comments INSERTs for ONE ticket over Supabase Realtime.
 *
 * Security: the socket is authenticated with the signed-in user's own
 * Supabase JWT, and Realtime checks every event against the
 * ticket_comments_select RLS policy for that JWT (migration 0007; proven by
 * backend/tests/test_realtime_rls.py). A client therefore never receives an
 * internal note or another organization's message. The ticket_id filter only
 * narrows what this page asks for; it is not the security boundary.
 *
 * Exactly one channel per mounted ticket page: it is removed on unmount and
 * whenever ticketId changes, so navigating between tickets never stacks
 * subscriptions. Any failure reports "down" and the caller polls instead.
 */
export function useTicketRealtime(ticketId: string, onInsert: (row: CommentRow) => void): RealtimeState {
  const [state, setState] = useState<RealtimeState>("connecting");
  const handler = useRef(onInsert);
  handler.current = onInsert;

  useEffect(() => {
    let cancelled = false;
    const supabase = createSupabaseBrowserClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    setState("connecting");

    (async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (cancelled) return;
      if (!token) {
        setState("down");
        return;
      }
      // Make sure the socket carries THIS user's JWT (RLS is evaluated with it).
      await supabase.realtime.setAuth(token);
      if (cancelled) return;
      channel = supabase
        .channel(`ticket-comments:${ticketId}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "ticket_comments", filter: `ticket_id=eq.${ticketId}` },
          (payload) => handler.current(payload.new as CommentRow)
        )
        .subscribe((status) => {
          if (cancelled) return;
          setState(status === "SUBSCRIBED" ? "live" : status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT" ? "down" : "connecting");
        });
    })().catch(() => {
      if (!cancelled) setState("down");
    });

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [ticketId]);

  return state;
}
