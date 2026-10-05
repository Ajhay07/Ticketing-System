import { forwardRef } from "react";
import { cn } from "./cn";

export const fieldClasses = cn(
  "block w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-xs",
  "placeholder:text-slate-400 transition-colors",
  "hover:border-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20",
  "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
);

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref
) {
  return <input ref={ref} className={cn(fieldClasses, "h-9", className)} {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, ...props },
  ref
) {
  return <select ref={ref} className={cn(fieldClasses, "h-9 pr-8", className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cn(fieldClasses, "py-2 leading-relaxed", className)} {...props} />;
  }
);

export function Label({
  htmlFor,
  children,
  hint,
  className,
}: {
  htmlFor?: string;
  children: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
}) {
  return (
    <label htmlFor={htmlFor} className={cn("mb-1.5 block text-sm font-medium text-slate-700", className)}>
      {children}
      {hint && <span className="ml-1 font-normal text-slate-400">{hint}</span>}
    </label>
  );
}

export function Checkbox({
  label,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: React.ReactNode }) {
  return (
    <label className={cn("inline-flex cursor-pointer select-none items-center gap-2 text-sm text-slate-700", className)}>
      <input type="checkbox" className="h-4 w-4 rounded border-slate-300" {...props} />
      {label}
    </label>
  );
}

export function FileInput({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="file"
      {...props}
      className={cn(
        "block w-full text-sm text-slate-600",
        "file:mr-3 file:h-9 file:cursor-pointer file:rounded-md file:border file:border-solid file:border-slate-300 file:bg-white",
        "file:px-3 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-50",
        className
      )}
    />
  );
}

export function ErrorText({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p role="alert" className={cn("rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700", className)}>
      {children}
    </p>
  );
}
