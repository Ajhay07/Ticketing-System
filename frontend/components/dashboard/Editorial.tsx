"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { apiJson, statusLabel, type Me, type Priority } from "@/lib/tickets";
import type { ReportsData } from "@/lib/admin";

/* ------------------------------------------------------------------ */
/* Swiss geometric accents - redrawn as crisp SVG from design-assets   */
/* 03 (slash), 04 (arrow) and 05 (plus); the JPEGs carry crop edges.   */
/* ------------------------------------------------------------------ */

export function SwissSlash({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("h-6 w-6", className)} aria-hidden fill="none" stroke="currentColor" strokeWidth={2.5}>
      <path d="M7 21 13 3M13 21 19 3" />
    </svg>
  );
}

export function SwissArrow({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={cn("h-12 w-12", className)} aria-hidden fill="none" stroke="currentColor" strokeWidth={3}>
      <path d="M8 40 40 8M16 8h24v24" />
    </svg>
  );
}

export function SwissPlus({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("h-5 w-5", className)} aria-hidden fill="none" stroke="currentColor" strokeWidth={2.5}>
      <path d="M12 2v20M2 12h20" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Greeting header                                                     */
/* ------------------------------------------------------------------ */

function partOfDay(h: number) {
  if (h < 12) return "Good morning,";
  if (h < 18) return "Good afternoon,";
  return "Good evening,";
}

/** Display name from the signed-in user's own email (e.g. cto@... -> "CTO", jane.doe@... -> "Jane"). */
function displayName(me: Me | undefined): string {
  if (!me?.email) return "";
  const local = me.email.split("@")[0]?.split(/[._-]/)[0] ?? "";
  if (!local) return statusLabel(me.role);
  return local.length <= 3 ? local.toUpperCase() : local.charAt(0).toUpperCase() + local.slice(1);
}

/**
 * Editorial dashboard header: uppercase date label, oversized greeting using
 * the real signed-in user, supporting line. Rendered on dashboards only.
 */
export function DashboardGreeting({
  section,
  description,
  actions,
}: {
  section: string;
  description: string;
  actions?: React.ReactNode;
}) {
  const me = useQuery({ queryKey: ["me"], queryFn: () => apiJson<Me>("/api/me") });
  // Time-dependent text is set after mount to avoid a server/client mismatch.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);
  const name = displayName(me.data);
  const date = now
    ? now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    : " ";

  return (
    <header className="mb-10 grid gap-6 border-b border-cf-ink pb-8 lg:grid-cols-12 lg:items-end">
      <div className="lg:col-span-8">
        <p className="cf-label flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-cf-ink">{section}</span>
          <span className="h-px w-6 bg-cf-ink" aria-hidden />
          <span suppressHydrationWarning>{date}</span>
        </p>
        <h1 className="cf-display mt-5">
          <span className="block" suppressHydrationWarning>
            {now ? partOfDay(now.getHours()) : "Hello,"}
          </span>
          <span className="block">{name ? `${name}.` : " "}</span>
        </h1>
        <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-cf-slate">{description}</p>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 lg:col-span-4 lg:justify-end">{actions}</div>}
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Admin hero: monochrome architecture + cobalt block + statement      */
/* ------------------------------------------------------------------ */

const HERO_SRC = "/design-assets/02_brutalist_hero_architecture.jpg";
// Show only the architectural half of the 1030x283 reference (building +
// its cobalt block, x 0..545); the baked-in text is replaced by live type.
const HERO_W = 1030;
const HERO_H = 283;
const HERO_CROP_W = 545;

export function AdminHero() {
  return (
    <section
      aria-label="ClickfieldAI Operations"
      className="mb-10 hidden overflow-hidden border border-cf-border bg-white md:grid md:grid-cols-12"
    >
      <div className="relative overflow-hidden md:col-span-7 xl:col-span-6" style={{ aspectRatio: `${HERO_CROP_W} / ${HERO_H}` }}>
        <Image
          src={HERO_SRC}
          alt=""
          width={HERO_W}
          height={HERO_H}
          priority
          sizes="(min-width: 1280px) 800px, 60vw"
          className="absolute left-0 top-0 h-full max-w-none"
          style={{ width: `${(HERO_W / HERO_CROP_W) * 100}%` }}
        />
      </div>
      <div className="cf-dot-grid relative z-10 flex flex-col justify-between gap-6 border-l border-cf-border bg-white p-8 md:col-span-5 xl:col-span-6 xl:p-10">
        <div className="flex items-start justify-between gap-6">
          <p className="text-[26px] font-extrabold uppercase leading-[0.98] tracking-[-0.03em] text-cf-black xl:text-[32px]">
            Keep
            <br />
            customers
            <br />
            moving.
          </p>
          <SwissSlash className="hidden shrink-0 text-cf-black xl:block" />
        </div>
        <div className="flex items-end justify-between gap-6">
          <div className="flex-1">
            <span className="block h-[2px] w-full max-w-[220px] bg-cf-black" aria-hidden />
            <p className="cf-label mt-4 !text-cf-ink">Track. Prioritize. Resolve.</p>
          </div>
          <SwissArrow className="shrink-0 text-cf-black" />
        </div>
        <span className="absolute right-0 top-0 h-3 w-3 bg-cf-blue" aria-hidden />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Ticket Trends - hand-built SVG bars on existing reports data         */
/* ------------------------------------------------------------------ */

const TREND_DAYS = 14;

function lastDays(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - i));
    out.push(x.toISOString().slice(0, 10));
  }
  return out;
}

/** Daily ticket volume (tickets created) for the last 14 days, from /api/admin/reports. */
export function TicketTrends() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["reports", 30],
    queryFn: () => apiJson<ReportsData>("/api/admin/reports?days=30"),
  });
  const [days, setDays] = useState<string[]>([]);
  useEffect(() => setDays(lastDays(TREND_DAYS)), []);

  const counts = new Map<string, number>();
  for (const row of data?.volume.day ?? []) counts.set(String(row.period).slice(0, 10), Number(row.tickets));
  const series = days.map((d) => ({ day: d, n: counts.get(d) ?? 0 }));
  const max = Math.max(1, ...series.map((s) => s.n));
  const total = series.reduce((a, s) => a + s.n, 0);
  const firstHalf = series.slice(0, 7).reduce((a, s) => a + s.n, 0);
  const lastHalf = series.slice(7).reduce((a, s) => a + s.n, 0);

  return (
    <section className="flex h-full flex-col border border-cf-border bg-white">
      <div className="flex items-start justify-between gap-4 border-b border-cf-border px-5 py-4">
        <div>
          <h2 className="cf-section">Ticket trends</h2>
          <p className="mt-1 text-xs text-cf-slate">Tickets created per day, last {TREND_DAYS} days</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-extrabold leading-none tracking-[-0.04em] text-cf-ink tabular">{data ? total : "–"}</p>
          {data && (
            <p className="mt-1 text-[11px] text-cf-slate tabular">
              {lastHalf} this week · {firstHalf} prior
            </p>
          )}
        </div>
      </div>
      <div className="flex-1 px-5 pb-4 pt-6">
        {isLoading && <div className="h-40 animate-pulse bg-cf-soft" role="status" aria-label="Loading trends" />}
        {error && <p className="py-12 text-center text-sm text-cf-slate">Trend data is unavailable.</p>}
        {data && days.length > 0 && (
          <>
            <div className="flex h-40 items-end gap-1.5 border-b border-cf-ink" role="img" aria-label={`Tickets created per day: ${series.map((s) => `${s.day} ${s.n}`).join(", ")}`}>
              {series.map((s, i) => (
                <div key={s.day} className="group relative flex h-full flex-1 flex-col justify-end" title={`${s.day}: ${s.n}`}>
                  <div
                    className={cn("w-full transition-opacity duration-150 group-hover:opacity-80", i === series.length - 1 ? "bg-cf-blue" : "bg-cf-black")}
                    style={{ height: `${s.n === 0 ? 0 : Math.max(4, (s.n / max) * 100)}%` }}
                  />
                </div>
              ))}
            </div>
            <div className="mt-2 flex justify-between text-[10px] font-semibold uppercase tracking-[0.08em] text-cf-muted tabular">
              <span>{series[0]?.day.slice(5)}</span>
              <span>Today</span>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Priority Queue - compact Swiss list                                 */
/* ------------------------------------------------------------------ */

const PRIORITY_DOT: Record<Priority, string> = {
  LOW: "bg-cf-muted",
  MEDIUM: "bg-cf-blue",
  HIGH: "bg-cf-orange",
  CRITICAL: "bg-cf-red",
};

export function PriorityQueue({
  rows,
  href,
}: {
  rows: { priority: Priority; count: number }[];
  href: string;
}) {
  const ordered = [...rows].sort(
    (a, b) => ["CRITICAL", "HIGH", "MEDIUM", "LOW"].indexOf(a.priority) - ["CRITICAL", "HIGH", "MEDIUM", "LOW"].indexOf(b.priority)
  );
  return (
    <section className="flex h-full flex-col border border-cf-border bg-white">
      <div className="border-b border-cf-border px-5 py-4">
        <h2 className="cf-section">Priority queue</h2>
        <p className="mt-1 text-xs text-cf-slate">Open work by priority</p>
      </div>
      <ul className="flex-1 divide-y divide-cf-border">
        {ordered.map((p) => {
          const hot = p.priority === "CRITICAL" && p.count > 0;
          return (
            <li key={p.priority}>
              <Link
                href={href}
                className="group flex h-14 items-center gap-3 px-5 transition-colors duration-150 hover:bg-cf-soft"
              >
                <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", PRIORITY_DOT[p.priority])} aria-hidden />
                <span className="flex-1 text-[13px] font-bold uppercase tracking-[0.06em] text-cf-ink">
                  {statusLabel(p.priority)}
                </span>
                <span className={cn("text-2xl font-extrabold tracking-[-0.04em] tabular", hot ? "text-cf-red" : "text-cf-ink")}>
                  {p.count}
                </span>
                <ArrowUpRight
                  className="h-4 w-4 text-cf-muted transition-transform duration-150 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-cf-ink"
                  aria-hidden
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
