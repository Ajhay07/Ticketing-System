import { cn } from "./cn";

export type BadgeTone =
  | "slate"
  | "blue"
  | "indigo"
  | "violet"
  | "cyan"
  | "amber"
  | "orange"
  | "green"
  | "red"
  | "redSolid"
  | "ink";

/**
 * Compact, square-cornered status chips on the --cf-* palette. Colour carries
 * meaning: blue = open/info, yellow = waiting, orange = high, red = critical /
 * overdue, green = resolved, purple = unassigned, slate = low/neutral.
 */
const TONES: Record<BadgeTone, { pill: string; dot: string }> = {
  slate: { pill: "border-cf-border bg-cf-soft text-cf-slate", dot: "bg-cf-muted" },
  ink: { pill: "border-cf-ink bg-white text-cf-ink", dot: "bg-cf-ink" },
  blue: { pill: "border-blue-200 bg-blue-50 text-blue-700", dot: "bg-cf-blue" },
  indigo: { pill: "border-blue-200 bg-white text-blue-700", dot: "bg-cf-blue" },
  violet: { pill: "border-violet-200 bg-violet-50 text-violet-700", dot: "bg-cf-purple" },
  cyan: { pill: "border-cf-blue bg-cf-blue text-white", dot: "bg-white" },
  amber: { pill: "border-yellow-300 bg-yellow-50 text-yellow-800", dot: "bg-cf-yellow" },
  orange: { pill: "border-orange-200 bg-orange-50 text-orange-700", dot: "bg-cf-orange" },
  green: { pill: "border-emerald-200 bg-emerald-50 text-emerald-700", dot: "bg-cf-green" },
  red: { pill: "border-red-200 bg-red-50 text-red-700", dot: "bg-cf-red" },
  redSolid: { pill: "border-cf-red bg-cf-red text-white", dot: "bg-white" },
};

export function Badge({
  tone = "slate",
  dot,
  icon,
  className,
  children,
}: {
  tone?: BadgeTone;
  dot?: boolean;
  icon?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const t = TONES[tone];
  return (
    <span
      className={cn(
        "inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-sm border px-1.5 text-[11px] font-semibold uppercase leading-none tracking-[0.06em]",
        t.pill,
        className
      )}
    >
      {dot && <span className={cn("h-1.5 w-1.5 shrink-0", t.dot)} aria-hidden />}
      {icon}
      {children}
    </span>
  );
}
