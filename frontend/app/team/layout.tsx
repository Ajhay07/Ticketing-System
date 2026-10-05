import { SidebarShell } from "@/components/shell/AppShell";

/** Navigation shell only. The API/RLS scopes every team request. */
export default function TeamLayout({ children }: { children: React.ReactNode }) {
  return <SidebarShell area="team">{children}</SidebarShell>;
}
