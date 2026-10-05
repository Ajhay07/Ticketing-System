import Link from "next/link";

export default function TeamDashboardPage() {
  return (
    <main className="mx-auto max-w-5xl p-8">
      <h1 className="text-2xl font-semibold text-slate-900">Team Dashboard</h1>
      <p className="mt-2 text-sm text-slate-500">
        Team members see only tickets assigned to them (decision #5).
      </p>
      <Link
        href="/team/tickets"
        className="mt-6 inline-block rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white"
      >
        My Assigned Tickets
      </Link>
    </main>
  );
}
