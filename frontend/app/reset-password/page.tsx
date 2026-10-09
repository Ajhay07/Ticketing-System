"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { AuthCard } from "@/components/shell/AuthCard";
import { Button } from "@/components/ui/Button";
import { ErrorText, Input, Label } from "@/components/ui/Form";
import { Spinner } from "@/components/ui/States";

/**
 * Landing page for a Supabase "recovery" link (password-reset or first-time
 * invite). Supabase redirects here with the session tokens in the URL
 * fragment (#access_token=...&type=recovery); the browser Supabase client
 * (detectSessionInUrl, on by default) picks them up and fires a
 * PASSWORD_RECOVERY auth event - we listen for that, then let the user set
 * a new password via supabase.auth.updateUser().
 *
 * This route MUST be public in middleware.ts (alongside /login and
 * /forgot-password): the tokens live only in the URL fragment, which the
 * browser never sends to the server, so middleware can't see a session on
 * this very first request - if middleware gated this route, it would bounce
 * the user away before the client ever got a chance to read the fragment.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();

    // If a session is already present by the time this mounts (fragment
    // already processed), allow the form immediately.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || (event === "SIGNED_IN" && session)) {
        setReady(true);
      }
    });

    // If no recovery session shows up quickly, the link was invalid/expired
    // (or this page was opened directly) - send them to request a fresh one
    // rather than leaving a dead form on screen.
    const timeout = setTimeout(() => {
      supabase.auth.getSession().then(({ data }) => {
        if (!data.session) {
          router.replace("/forgot-password");
        }
      });
    }, 4000);

    return () => {
      sub.subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, [router]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    const supabase = createSupabaseBrowserClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (updateError) {
      setError(updateError.message || "Could not set your password. Try the link again.");
      return;
    }

    setDone(true);
    setTimeout(() => {
      router.push("/");
      router.refresh();
    }, 1200);
  }

  return (
    <AuthCard title="Set your password" subtitle="Choose a password for your ClickfieldAI account.">
      {!ready && !done && (
        <div className="flex items-center gap-2 text-sm text-cf-slate">
          <Spinner />
          Verifying your link...
        </div>
      )}

      {ready && !done && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="password">New password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-10"
            />
          </div>
          <div>
            <Label htmlFor="confirm">Confirm password</Label>
            <Input
              id="confirm"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="h-10"
            />
          </div>

          {error && <ErrorText>{error}</ErrorText>}

          <Button type="submit" variant="primary" disabled={loading} className="h-10 w-full">
            {loading && <Spinner className="text-white/80" />}
            {loading ? "Setting password..." : "Set password and continue"}
          </Button>
        </form>
      )}

      {done && (
        <p className="text-sm text-cf-slate">Password set. Taking you to your dashboard...</p>
      )}
    </AuthCard>
  );
}
