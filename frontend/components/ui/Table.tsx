"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "./cn";

/** Wraps a table so wide content scrolls horizontally inside its card. */
export function TableContainer({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm", className)}>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return <table className={cn("w-full border-collapse text-left text-sm", className)}>{children}</table>;
}

export function THead({ children }: { children: React.ReactNode }) {
  return <thead className="border-b border-slate-200 bg-slate-50/80">{children}</thead>;
}

export function TH({ children, className, align }: { children?: React.ReactNode; className?: string; align?: "right" }) {
  return (
    <th
      scope="col"
      className={cn(
        "whitespace-nowrap px-4 py-2.5 text-2xs font-semibold uppercase tracking-wider text-slate-500",
        align === "right" && "text-right",
        className
      )}
    >
      {children}
    </th>
  );
}

export function TBody({ children }: { children: React.ReactNode }) {
  return <tbody className="divide-y divide-slate-100">{children}</tbody>;
}

export function TD({ children, className, align }: { children?: React.ReactNode; className?: string; align?: "right" }) {
  return (
    <td
      className={cn(
        "whitespace-nowrap px-4 py-3 align-middle text-slate-700",
        align === "right" && "text-right tabular",
        className
      )}
    >
      {children}
    </td>
  );
}

/**
 * Row that navigates on click. The real link inside the row (e.g. the ticket
 * number) remains the keyboard and screen-reader target; the row click is a
 * pointer convenience only.
 */
export function TR({ href, children, className }: { href?: string; children: React.ReactNode; className?: string }) {
  const router = useRouter();
  return (
    <tr
      className={cn("transition-colors hover:bg-slate-50/80", href && "cursor-pointer", className)}
      onClick={
        href
          ? (e) => {
              const target = e.target as HTMLElement;
              if (target.closest("a,button,input,select,textarea,label")) return;
              router.push(href);
            }
          : undefined
      }
    >
      {children}
    </tr>
  );
}

/** Ticket number cell content: monospace, tabular, linked. */
export function TicketNumberLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded font-mono text-xs font-medium text-slate-500 hover:text-brand-700 hover:underline"
    >
      {children}
    </Link>
  );
}
