import Link from "next/link";

const LINKS = [
  { href: "/admin/dashboard", label: "Dashboard" },
  { href: "/admin/tickets", label: "Tickets" },
  { href: "/admin/unassigned", label: "Unassigned" },
  { href: "/admin/team", label: "Team" },
  { href: "/admin/clients", label: "Clients" },
  { href: "/admin/reports", label: "Reports" },
];

/** Navigation only. Every admin endpoint is enforced server-side (403 otherwise). */
export function AdminNav() {
  return (
    <nav className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap gap-5 px-8 py-3 text-sm">
        <span className="font-semibold text-slate-900">Clickfield AI</span>
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className="text-slate-600 hover:text-slate-900">
            {l.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
