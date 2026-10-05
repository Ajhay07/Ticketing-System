import { SidebarShell } from "@/components/shell/AppShell";

/** Navigation shell only. Every admin endpoint is enforced server-side (403 otherwise). */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <SidebarShell area="admin">{children}</SidebarShell>;
}
