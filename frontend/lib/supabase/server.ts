import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server-side Supabase client, used in Server Components / Route Handlers to
 * read the current session's cookies.
 *
 * IMPORTANT: this client (and the session it reads) is for UX/navigation
 * decisions ONLY - e.g. redirecting a logged-out visitor to /login, or
 * picking which dashboard shell to render. It must NEVER be treated as an
 * authorization check for data access. All real authorization happens in
 * the FastAPI backend (verified JWT -> Principal) and in Postgres RLS. See
 * CLAUDE.md rule 3.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          cookieStore.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          cookieStore.set({ name, value: "", ...options });
        },
      },
    }
  );
}
