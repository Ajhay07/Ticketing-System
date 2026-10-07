import { cn } from "@/components/ui/cn";

/**
 * ClickfieldAI brand mark. This is the ONLY place logo markup lives - every
 * shell, auth page and header renders <ClickfieldLogo />.
 *
 * No official logo file exists in the repo yet, so the mark is a drawn icon
 * using the `brand-*` tokens from tailwind.config.ts. To drop in a real logo
 * later: put it in /public (e.g. /public/clickfieldai-mark.svg) and set
 * LOGO_MARK_SRC below; the icon slot will render the image instead.
 */
export const BRAND_NAME = "ClickfieldAI";
const LOGO_MARK_SRC: string | null = null;

type Size = "sm" | "md" | "lg";

const MARK_SIZE: Record<Size, string> = {
  sm: "h-7 w-7 rounded-md",
  md: "h-8 w-8 rounded-md",
  lg: "h-11 w-11 rounded-lg",
};
const GLYPH_SIZE: Record<Size, string> = { sm: "h-4 w-4", md: "h-[18px] w-[18px]", lg: "h-6 w-6" };
const TEXT_SIZE: Record<Size, string> = { sm: "text-sm", md: "text-sm", lg: "text-lg" };

export function ClickfieldLogo({
  variant = "full",
  size = "md",
  sub,
  className,
}: {
  /** full = icon + wordmark, compact = icon only */
  variant?: "full" | "compact";
  size?: Size;
  /** optional small caption under the wordmark (e.g. "Admin console") */
  sub?: string;
  className?: string;
}) {
  const mark = LOGO_MARK_SRC ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={LOGO_MARK_SRC} alt="" className={cn("shrink-0 object-contain", MARK_SIZE[size])} />
  ) : (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center bg-brand-600 text-white shadow-sm",
        MARK_SIZE[size]
      )}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" className={GLYPH_SIZE[size]} fill="none" stroke="currentColor" strokeWidth={2.5}>
        <path d="M17 7.5a6 6 0 1 0 0 9" strokeLinecap="round" />
        <circle cx="17.5" cy="12" r="1.6" fill="currentColor" stroke="none" />
      </svg>
    </span>
  );

  if (variant === "compact") {
    return (
      <span className={cn("inline-flex", className)} role="img" aria-label={BRAND_NAME}>
        {mark}
      </span>
    );
  }

  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      {mark}
      <span className="leading-tight">
        <span className={cn("block font-semibold tracking-tight text-slate-900", TEXT_SIZE[size])}>
          Clickfield<span className="text-brand-600">AI</span>
        </span>
        {sub && <span className="block text-2xs font-medium uppercase tracking-wider text-slate-400">{sub}</span>}
      </span>
    </span>
  );
}
