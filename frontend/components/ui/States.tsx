import { AlertCircle, Inbox, Loader2, RotateCw } from "lucide-react";
import { buttonClasses } from "./Button";
import { cn } from "./cn";

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
  compact,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "px-4 py-6" : "px-6 py-12",
        className
      )}
    >
      <div
        className={cn(
          "flex items-center justify-center rounded-full bg-slate-100 text-slate-400",
          compact ? "h-9 w-9" : "h-11 w-11"
        )}
      >
        <Icon className={compact ? "h-4 w-4" : "h-5 w-5"} />
      </div>
      <p className="mt-3 text-sm font-medium text-slate-700">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-4 w-4 animate-spin text-slate-400", className)} aria-hidden />;
}

export function LoadingState({ label = "Loading...", className }: { label?: string; className?: string }) {
  return (
    <div role="status" className={cn("flex items-center justify-center gap-2 px-6 py-12 text-sm text-slate-500", className)}>
      <Spinner />
      {label}
    </div>
  );
}

/** Friendly error with optional retry. Raw server errors are shown only as secondary detail. */
export function ErrorState({
  message = "Something went wrong.",
  detail,
  onRetry,
  className,
}: {
  message?: string;
  detail?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div role="alert" className={cn("rounded-lg border border-red-200 bg-white px-6 py-10 text-center shadow-sm", className)}>
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-red-50 text-red-600">
        <AlertCircle className="h-5 w-5" />
      </div>
      <p className="mt-3 text-sm font-medium text-slate-800">{message}</p>
      <p className="mt-1 text-sm text-slate-500">{detail ?? "Please check your connection and try again."}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className={cn(buttonClasses("secondary", "md"), "mt-4")}>
          <RotateCw className="h-4 w-4" />
          Try again
        </button>
      )}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-slate-200/70", className)} />;
}
