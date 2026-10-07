import { BRAND_NAME, ClickfieldLogo } from "@/components/ClickfieldLogo";

/** Centered card used by the unauthenticated pages (login, password reset). */
export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-[400px]">
        <div className="mb-6 flex flex-col items-center text-center">
          <ClickfieldLogo size="lg" />
          <h1 className="mt-5 text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-slate-500">{subtitle}</p>}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-lg sm:p-8">{children}</div>
        {footer && <div className="mt-6 text-center text-sm text-slate-500">{footer}</div>}
        <p className="mt-8 text-center text-xs text-slate-400">{BRAND_NAME} &middot; Client Support Portal</p>
      </div>
    </main>
  );
}
