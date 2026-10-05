import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { destinationForRole } from "@/lib/roleRouting";

/**
 * Root route: send the visitor somewhere useful. This is navigation
 * convenience only - the destination pages each independently depend on
 * authorized API calls for any real data (CLAUDE.md rule 3).
 */
export default async function HomePage() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getSession();

  if (!data.session) {
    redirect("/login");
  }

  const role = data.session?.user.app_metadata?.role as string | undefined;
  redirect(destinationForRole(role));
}
