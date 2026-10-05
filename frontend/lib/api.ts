import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/**
 * Thin fetch wrapper that attaches the current Supabase access token as a
 * bearer token. The backend re-verifies this token on every request and
 * derives role/organization_id from it - the frontend sends nothing about
 * identity beyond the token itself (CLAUDE.md rule 4).
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const supabase = createSupabaseBrowserClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const headers = new Headers(init.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  return fetch(`${API_BASE_URL}${path}`, { ...init, headers });
}
