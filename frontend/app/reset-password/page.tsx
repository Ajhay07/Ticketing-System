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

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || (event === "SIGNED_IN" && session)) {
        setReady(true);
      }
    });

    // The SSR browser client does not auto-detect URL fragments. Parse the
    // fragment ourselves and exchange the tokens to establish a session.
    const hash = window.location.hash.substring(1);
    if (hash) {
      const params = new URLSearchParams(hash);
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");
      if (accessToken && refreshToken) {
        supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }).then(({ error: err }) => {
          if (err) {
            setError("Your link has expired. Please request a new one.");
          }
        });
      }
    }

    // If no recovery session shows up after a generous window, the link was
    // invalid/expired or the page was opened directly.
    const timeout = setTimeout(() => {
      supabase.auth.getSession().then(({ data }) => {
        if (!data.session) {
          router.replace("/forgot-password");
        }
      });
    }, 10000);

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
