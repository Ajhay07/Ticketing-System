import { cn } from "./cn";

/** Flat white panel with a 1px structural border (no shadow, restrained radius). */
export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("rounded border border-cf-border bg-white", className)}>{children}</div>;
}

export function CardHeader({
  title,
  description,
  actions,
  icon,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-cf-border px-5 py-4">
      <div className="flex min-w-0 items-center gap-2.5">
        {icon && <span className="text-cf-ink">{icon}</span>}
        <div className="min-w-0">
          <h2 className="cf-section">{title}</h2>
          {description && <p className="mt-1 text-xs text-cf-slate">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * Page title block: optional uppercase eyebrow label, heavy editorial title,
 * supporting line, and a thin rule underneath (Swiss header).
 */
export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  eyebrow?: React.ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-cf-border pb-6">
      <div className="min-w-0">
        {eyebrow && <div className="mb-3">{eyebrow}</div>}
        <h1 className="cf-title">{title}</h1>
        {description && <p className="mt-3 text-sm leading-relaxed text-cf-slate">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SectionTitle({
  children,
  className,
  actions,
}: {
  children: React.ReactNode;
  className?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className={cn("mb-4 flex items-center justify-between gap-3", className)}>
      <h2 className="cf-section">{children}</h2>
      {actions}
    </div>
  );
}

/** Standard page container inside the app shell (16 / 24 / 40px gutters). */
export function Page({ children, narrow }: { children: React.ReactNode; narrow?: boolean }) {
  return (
    <main className={cn("mx-auto w-full px-4 py-6 sm:px-6 lg:px-10 lg:py-10", narrow ? "max-w-3xl" : "max-w-[1440px]")}>
      {children}
    </main>
  );
}
