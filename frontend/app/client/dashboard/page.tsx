import Link from "next/link";

export default function ClientDashboardPage() {
  return (
    <main className="mx-auto max-w-5xl p-8">
      <h1 className="text-2xl font-semibold text-slate-900">Support</h1>
      <p className="mt-2 text-sm text-slate-500">
        Dashboard metrics land in a later phase. Use the links below to raise and track tickets.
      </p>
      <div className="mt-6 flex gap-3">
        <Link href="/client/tickets/new" className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">
          Create New Ticket
        </Link>
        <Link href="/client/tickets" className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800">
          My Tickets
        </Link>
      </div>
    </main>
  );
}
