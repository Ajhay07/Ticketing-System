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
  | "redSolid";

const TONES: Record<BadgeTone, { pill: string; dot: string }> = {
  slate: { pill: "bg-slate-100 text-slate-700 ring-slate-500/15", dot: "bg-slate-400" },
  blue: { pill: "bg-blue-50 text-blue-700 ring-blue-600/15", dot: "bg-blue-500" },
  indigo: { pill: "bg-indigo-50 text-indigo-700 ring-indigo-600/15", dot: "bg-indigo-500" },
  violet: { pill: "bg-violet-50 text-violet-700 ring-violet-600/15", dot: "bg-violet-500" },
  cyan: { pill: "bg-cyan-50 text-cyan-800 ring-cyan-600/20", dot: "bg-cyan-500" },
  amber: { pill: "bg-amber-50 text-amber-800 ring-amber-600/20", dot: "bg-amber-500" },
  orange: { pill: "bg-orange-50 text-orange-700 ring-orange-600/20", dot: "bg-orange-500" },
  green: { pill: "bg-emerald-50 text-emerald-700 ring-emerald-600/20", dot: "bg-emerald-500" },
  red: { pill: "bg-red-50 text-red-700 ring-red-600/20", dot: "bg-red-500" },
  redSolid: { pill: "bg-red-600 text-white ring-red-700/30", dot: "bg-white" },
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
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        t.pill,
        className
      )}
    >
      {dot && <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", t.dot)} aria-hidden />}
      {icon}
      {children}
    </span>
  );
}
