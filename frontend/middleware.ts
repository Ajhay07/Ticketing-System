import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Route-level redirect for unauthenticated visitors. THIS IS UX ONLY.
 *
 * It exists so a logged-out user is sent to /login instead of seeing a
 * broken dashboard shell. It grants no data access and must never be relied
 * upon as a security boundary (CLAUDE.md rule 3) - every API call the
 * resulting pages make is independently authorized by FastAPI + Postgres
 * RLS using the caller's verified JWT, regardless of what this middleware
 * decided.
 */
export async function middleware(request: NextRequest) {
  const response = NextResponse.next();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          response.cookies.set({ name, value: "", ...options });
        },
      },
    }
  );

  const { data } = await supabase.auth.getSession();
  const isPublicRoute =
    request.nextUrl.pathname.startsWith("/login") ||
    request.nextUrl.pathname.startsWith("/forgot-password");

  if (!data.session && !isPublicRoute) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  // Public static assets (logo, favicons) must load without a session - the
  // login page and emails need them.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|branding/|design-assets/).*)"],
};
