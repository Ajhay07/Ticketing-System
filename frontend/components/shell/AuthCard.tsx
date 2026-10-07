import Image from "next/image";
import { BRAND_NAME, ClickfieldLogo } from "@/components/ClickfieldLogo";

/**
 * Unauthenticated layout (login, password reset): Swiss split screen. Left is
 * an editorial panel (monochrome architecture + cobalt block), shown from lg;
 * right is the form column.
 */
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
    <main className="grid min-h-screen bg-white lg:grid-cols-2">
      <section aria-hidden className="relative hidden overflow-hidden border-r border-cf-ink bg-cf-soft lg:block">
        <div className="cf-dot-grid absolute inset-0 opacity-60" />
        <div className="absolute left-16 top-16 h-56 w-56 bg-cf-blue" />
        <div className="absolute bottom-0 left-28 right-0 top-32 overflow-hidden">
          <Image
            src="/design-assets/08_brutalist_building_03.jpg"
            alt=""
            fill
            sizes="50vw"
            className="scale-[1.04] object-cover grayscale"
            priority
          />
        </div>
        <div className="absolute bottom-16 left-16 bg-white px-6 py-5">
          <p className="text-[28px] font-extrabold uppercase leading-[0.98] tracking-[-0.03em] text-cf-black">
            Track.
            <br />
            Prioritize.
            <br />
            Resolve.
          </p>
        </div>
      </section>

      <div className="flex flex-col justify-center px-4 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-[400px]">
          <ClickfieldLogo size="lg" />
          <p className="cf-label mt-10">Support portal</p>
          <h1 className="mt-3 text-[34px] font-extrabold leading-none tracking-[-0.04em] text-cf-black sm:text-[40px]">
            {title}
          </h1>
          {subtitle && <p className="mt-3 text-sm leading-relaxed text-cf-slate">{subtitle}</p>}
          <div className="mt-8 border-t border-cf-ink pt-8">{children}</div>
          {footer && <div className="mt-6 text-sm text-cf-slate">{footer}</div>}
          <p className="cf-label mt-12 !text-[10px] !text-cf-muted">{BRAND_NAME} &middot; Client Support Portal</p>
        </div>
      </div>
    </main>
  );
}
