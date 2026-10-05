import Link from "next/link";

export default function AdminDashboardPage() {
  return (
    <main className="mx-auto max-w-5xl p-8">
      <h1 className="text-2xl font-semibold text-slate-900">CTO Dashboard</h1>
      <p className="mt-2 text-sm text-slate-500">
        Metrics, priority queue, and unassigned queue land in Phase 3.
      </p>
      <Link
        href="/admin/tickets"
        className="mt-6 inline-block rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white"
      >
        All Tickets
      </Link>
    </main>
  );
}
