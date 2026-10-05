import { ClientShell } from "@/components/shell/AppShell";

/** Navigation shell only. The API/RLS scopes every client request to their organization. */
export default function ClientLayout({ children }: { children: React.ReactNode }) {
  return <ClientShell>{children}</ClientShell>;
}
