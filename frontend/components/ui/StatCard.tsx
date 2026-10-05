import Link from "next/link";
import { cn } from "./cn";

type Tone = "neutral" | "brand" | "danger" | "warning" | "success" | "violet";

const TONES: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-600",
  brand: "bg-brand-50 text-brand-600",
  danger: "bg-red-50 text-red-600",
  warning: "bg-amber-50 text-amber-600",
  success: "bg-emerald-50 text-emerald-600",
  violet: "bg-violet-50 text-violet-600",
};

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
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-slate-500">{label}</p>
        {Icon && (
          <span
            className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
              TONES[alert ? "danger" : tone]
            )}
          >
            <Icon className="h-4 w-4" />
          </span>
        )}
      </div>
      <p
        className={cn(
          "mt-1 text-3xl font-semibold tabular tracking-tight",
          alert ? "text-red-600" : "text-slate-900"
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </>
  );
  const classes = cn(
    "block rounded-lg border bg-white p-4 shadow-sm",
    alert ? "border-red-200 ring-1 ring-red-100" : "border-slate-200"
  );
  if (href) {
    return (
      <Link href={href} className={cn(classes, "transition-shadow hover:border-slate-300 hover:shadow-md")}>
        {body}
      </Link>
    );
  }
  return <div className={classes}>{body}</div>;
}
