"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus, Search, SearchX, Ticket as TicketIcon } from "lucide-react";
import { DueDate, OverdueBadge, PriorityBadge, StatusBadge } from "@/components/tickets/Badges";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Page, PageHeader } from "@/components/ui/Card";
import { Checkbox, Input, Select } from "@/components/ui/Form";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/States";
import { Table, TableContainer, TBody, TD, TH, THead, TicketNumberLink, TR } from "@/components/ui/Table";
import { unreadTicketIds } from "@/lib/chat";
import type { Notification } from "@/lib/admin";
import {
  apiJson,
  formatDate,
  PAGE_SIZES,
  PRIORITIES,
  SORT_OPTIONS,
  STATUSES,
  statusLabel,
  ticketListPath,
  type TicketPage,
} from "@/lib/tickets";

type Props = {
  title: string;
  basePath: string;
  showCreate?: boolean;
  showOrganization?: boolean;
  emptyMessage?: string;
  /** Admin-only filters (overdue / unassigned). UX only - the API enforces access. */
  adminFilters?: boolean;
};

/** Ticket list. Which rows appear is decided entirely by the API + RLS. */
export function TicketList(props: Props) {
  // useSearchParams needs a Suspense boundary for static prerendering.
  return (
    <Suspense fallback={null}>
      <TicketListInner {...props} />
    </Suspense>
  );
}

function TicketListInner({ title, basePath, showCreate, showOrganization, emptyMessage, adminFilters }: Props) {
  // ?q= lets the top-bar search hand off to this list's existing search.
  const urlQ = useSearchParams().get("q") ?? "";
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(25);
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [search, setSearch] = useState(urlQ);
  const [q, setQ] = useState(urlQ);
  useEffect(() => {
    setSearch(urlQ);
    setQ(urlQ);
    setPage(1);
  }, [urlQ]);
  const [sort, setSort] = useState("default");
  const [overdue, setOverdue] = useState(false);
  const [unassigned, setUnassigned] = useState(false);

  const path = ticketListPath({ page, pageSize, status, priority, q, sort, overdue, unassigned });
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["tickets", path],
    queryFn: () => apiJson<TicketPage>(path),
    placeholderData: keepPreviousData,
  });

  // Unread dot: tickets with an unread in-app notification for this viewer
  // (existing notifications API; cleared when the ticket is opened).
  const unread = useQuery({
    queryKey: ["notifications", "unread"],
    queryFn: () => apiJson<{ items: Notification[]; unread: number }>("/api/notifications?unread_only=true&limit=100"),
    refetchInterval: 60_000,
  });
  const unreadIds = unreadTicketIds(unread.data?.items ?? []);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  const filtered = Boolean(q || status || priority || overdue || unassigned);
  const assignee = (t: TicketPage["items"][number]) =>
    t.assigned_to ? (t.assigned_to_name ?? "ClickfieldAI team") : "Unassigned";

  return (
    <Page>
      <PageHeader
        title={title}
        description={data ? `${data.total} ticket${data.total === 1 ? "" : "s"}` : undefined}
        actions={
          showCreate && (
            <ButtonLink href={`${basePath}/new`} variant="primary">
              <Plus className="h-4 w-4" />
              Create ticket
            </ButtonLink>
          )
        }
      />

      <div className="mb-6 flex flex-col gap-3 border-y border-cf-border py-4 lg:flex-row lg:items-center">
        <form
          className="relative flex-1 lg:max-w-sm"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            setQ(search);
            setPage(1);
          }}
        >
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cf-muted" />
          <Input
            type="search"
            aria-label="Search tickets"
            placeholder="Search number, subject, client, user..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button type="submit" className="sr-only">
            Search
          </button>
        </form>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label="Status filter"
            className="w-auto"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Priority filter"
            className="w-auto"
            value={priority}
            onChange={(e) => {
              setPriority(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All priorities</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {statusLabel(p)}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Sort"
            className="w-auto"
            value={sort}
            onChange={(e) => {
              setSort(e.target.value);
              setPage(1);
            }}
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          {adminFilters && (
            <div className="flex items-center gap-4 px-1">
              <Checkbox
                label="Overdue"
                checked={overdue}
                onChange={(e) => {
                  setOverdue(e.target.checked);
                  setPage(1);
                }}
              />
              <Checkbox
                label="Unassigned"
                checked={unassigned}
                onChange={(e) => {
                  setUnassigned(e.target.checked);
                  setPage(1);
                }}
              />
            </div>
          )}
        </div>
      </div>

      {isLoading && <TableSkeleton />}
      {error && !data && <ErrorState message="We couldn't load tickets." onRetry={() => refetch()} />}
      {data && data.items.length === 0 && (
        <TableContainer>
          {filtered ? (
            <EmptyState icon={SearchX} title="No tickets match your filters" description="Try a different search or clear a filter." />
          ) : (
            <EmptyState
              icon={TicketIcon}
              title={emptyMessage ?? "No tickets found."}
              action={
                showCreate && (
                  <ButtonLink href={`${basePath}/new`} variant="primary">
                    <Plus className="h-4 w-4" />
                    Create ticket
                  </ButtonLink>
                )
              }
            />
          )}
        </TableContainer>
      )}

      {data && data.items.length > 0 && (
        <>
          {/* Desktop / tablet: table */}
          <TableContainer className="hidden md:block">
            <Table>
              <THead>
                <tr>
                  <TH>Ticket</TH>
                  <TH>Subject</TH>
                  {showOrganization && <TH>Client</TH>}
                  <TH>Priority</TH>
                  <TH>Status</TH>
                  <TH>Assigned To</TH>
                  <TH>Created</TH>
                  <TH>Due</TH>
                </tr>
              </THead>
              <TBody>
                {data.items.map((t) => (
                  <TR key={t.id} href={`${basePath}/${t.id}`}>
                    <TD>
                      <span className="inline-flex items-center gap-1.5">
                        <TicketNumberLink href={`${basePath}/${t.id}`}>{t.ticket_number}</TicketNumberLink>
                        {unreadIds.has(t.id) && <UnreadDot />}
                      </span>
                    </TD>
                    <TD className="max-w-[320px] truncate font-semibold text-cf-ink">
                      <Link href={`${basePath}/${t.id}`} className="rounded-sm underline-offset-4 hover:underline">
                        {t.subject}
                      </Link>
                    </TD>
                    {showOrganization && (
                      <TD className="max-w-[180px] truncate text-slate-600">
                        <span title={t.organization_name ?? undefined}>{t.organization_name}</span>
                      </TD>
                    )}
                    <TD>
                      <PriorityBadge priority={t.priority} />
                    </TD>
                    <TD>
                      <StatusBadge status={t.status} />
                    </TD>
                    <TD className={`max-w-[160px] truncate ${t.assigned_to ? "text-slate-700" : "italic text-slate-400"}`}>
                      {assignee(t)}
                    </TD>
                    <TD className="tabular text-slate-500">{formatDate(t.created_at)}</TD>
                    <TD>
                      <DueDate value={formatDate(t.due_at)} overdue={t.is_overdue} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableContainer>

          {/* Mobile: stacked rows */}
          <ul className="divide-y divide-cf-border overflow-hidden rounded border border-cf-border bg-white md:hidden">
            {data.items.map((t) => (
              <li key={t.id}>
                <Link href={`${basePath}/${t.id}`} className="block px-4 py-4 transition-colors duration-150 hover:bg-cf-soft">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-cf-ink">
                      {t.ticket_number}
                      {unreadIds.has(t.id) && <UnreadDot />}
                    </span>
                    <span className="text-xs tabular text-slate-400">{formatDate(t.created_at)}</span>
                  </div>
                  <p className="mt-1.5 line-clamp-2 font-semibold tracking-[-0.01em] text-cf-ink">{t.subject}</p>
                  {showOrganization && <p className="mt-0.5 text-xs text-slate-500">{t.organization_name}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <PriorityBadge priority={t.priority} />
                    <StatusBadge status={t.status} />
                    {t.is_overdue && <OverdueBadge />}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      {data && data.total > 0 && (
        <div className="mt-6 flex flex-col-reverse items-center justify-between gap-3 border-t border-cf-border pt-4 text-[13px] text-cf-slate sm:flex-row">
          <span className="tabular">
            {data.total} ticket{data.total === 1 ? "" : "s"}
          </span>
          <div className="flex items-center gap-2">
            <Select
              aria-label="Tickets per page"
              className="w-auto"
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size} / page
                </option>
              ))}
            </Select>
            <Button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page" className="w-10 px-0">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="whitespace-nowrap tabular">
              Page {page} of {totalPages}
            </span>
            <Button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              aria-label="Next page"
              className="w-10 px-0"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </Page>
  );
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <TableContainer>
      <div role="status" aria-label="Loading" className="divide-y divide-cf-border">
        <div className="h-11 border-b border-cf-ink" />
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-6 px-4 py-3.5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3 flex-1" />
            <Skeleton className="hidden h-5 w-16 rounded-sm sm:block" />
            <Skeleton className="hidden h-5 w-20 rounded-sm sm:block" />
            <Skeleton className="hidden h-3 w-24 md:block" />
          </div>
        ))}
      </div>
    </TableContainer>
  );
}

function UnreadDot() {
  return (
    <span className="inline-flex h-2 w-2 shrink-0 rounded-full bg-cf-blue" title="New activity">
      <span className="sr-only">New activity</span>
    </span>
  );
}
