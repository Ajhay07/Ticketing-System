"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "./cn";

/** Wraps a table so wide content scrolls horizontally inside its card. */
export function TableContainer({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded border border-cf-border bg-white", className)}>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return <table className={cn("w-full border-collapse text-left text-sm", className)}>{children}</table>;
}

export function THead({ children }: { children: React.ReactNode }) {
  return <thead className="border-b border-cf-ink bg-white">{children}</thead>;
}

export function TH({ children, className, align }: { children?: React.ReactNode; className?: string; align?: "right" }) {
  return (
    <th
      scope="col"
      className={cn(
        "h-11 whitespace-nowrap px-4 text-[11px] font-bold uppercase tracking-[0.08em] text-cf-ink",
        align === "right" && "text-right",
        className
      )}
    >
      {children}
    </th>
  );
}

export function TBody({ children }: { children: React.ReactNode }) {
  return <tbody className="divide-y divide-cf-border">{children}</tbody>;
}

export function TD({ children, className, align }: { children?: React.ReactNode; className?: string; align?: "right" }) {
  return (
    <td
      className={cn(
        "h-[52px] whitespace-nowrap px-4 py-2 align-middle text-[13px] text-slate-700",
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
      className={cn("transition-colors duration-150 hover:bg-cf-soft", href && "cursor-pointer", className)}
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
      className="rounded-sm font-mono text-xs font-semibold text-cf-ink underline-offset-4 hover:underline"
    >
      {children}
    </Link>
  );
}
