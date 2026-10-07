import Link from "next/link";
import { cn } from "./cn";

type Tone = "neutral" | "brand" | "danger" | "warning" | "success" | "violet";

/** Small functional colour marker (square) next to the label. */
const MARKERS: Record<Tone, string> = {
  neutral: "bg-cf-muted",
  brand: "bg-cf-blue",
  danger: "bg-cf-red",
  warning: "bg-cf-yellow",
  success: "bg-cf-green",
  violet: "bg-cf-purple",
};

/** KPI tile: LABEL / large number / optional hint. Flat, 1px border, no shadow. */
export function StatCard({
  label,
  value,
  icon: Icon,
  tone = "neutral",
  href,
  alert,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  tone?: Tone;
  href?: string;
  alert?: boolean;
  hint?: React.ReactNode;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="cf-label flex items-center gap-2 whitespace-nowrap">
          <span className={cn("h-2 w-2 shrink-0", MARKERS[alert ? "danger" : tone])} aria-hidden />
          {label}
        </p>
        {Icon && <Icon className="hidden h-4 w-4 shrink-0 text-cf-muted 2xl:block" />}
      </div>
      <p className={cn("cf-kpi tabular mt-6", alert && "!text-cf-red")}>{value}</p>
      {hint && <p className="mt-2 text-xs text-cf-slate">{hint}</p>}
    </>
  );
  const classes = cn("block rounded border bg-white p-5", alert ? "border-cf-red" : "border-cf-border-strong");
  if (href) {
    return (
      <Link href={href} className={cn(classes, "transition-colors duration-150 hover:border-cf-ink")}>
        {body}
      </Link>
    );
  }
  return <div className={classes}>{body}</div>;
}
