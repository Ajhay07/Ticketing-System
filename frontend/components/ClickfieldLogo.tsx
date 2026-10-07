import Image from "next/image";

import { cn } from "@/components/ui/cn";

/**
 * ClickfieldAI brand mark. This is the ONLY place logo markup lives - every
 * shell, auth page and header renders <ClickfieldLogo />.
 *
 * Renders the OFFICIAL logo file (public/branding/clickfieldai-logo.webp,
 * 1968x798, black wordmark with generous white margins). It is never redrawn
 * or recoloured. The source file has wide built-in whitespace, so the image is
 * shown inside a fixed-aspect window that hides most of that margin (pure CSS
 * offsets on the same file - the pixels and proportions are untouched).
 * See docs/BRANDING.md.
 */
export const BRAND_NAME = "ClickfieldAI";
export const LOGO_SRC = "/branding/clickfieldai-logo.webp";

const LOGO_W = 1968;
const LOGO_H = 798;
// Visible window inside the source file (ink box 1518x184 at 222,294, plus padding).
const CROP = { left: 196, top: 270, width: 1572, height: 236 };

type Size = "sm" | "md" | "lg";

const HEIGHT: Record<Size, string> = { sm: "h-5", md: "h-6", lg: "h-9" };

export function ClickfieldLogo({
  size = "md",
  sub,
  className,
  priority = true,
}: {
  size?: Size;
  /** optional small caption under the wordmark (e.g. "Admin console") */
  sub?: string;
  className?: string;
  priority?: boolean;
}) {
  const mark = (
    <span
      className={cn("relative block shrink-0 overflow-hidden", HEIGHT[size])}
      style={{ aspectRatio: `${CROP.width} / ${CROP.height}` }}
    >
      <Image
        src={LOGO_SRC}
        alt={BRAND_NAME}
        width={LOGO_W}
        height={LOGO_H}
        priority={priority}
        sizes="320px"
        className="block h-auto max-w-none select-none object-contain"
        draggable={false}
        style={{
          width: `${(LOGO_W / CROP.width) * 100}%`,
          marginLeft: `${(-CROP.left / CROP.width) * 100}%`,
          marginTop: `${(-CROP.top / CROP.width) * 100}%`,
        }}
      />
    </span>
  );

  if (!sub) return <span className={cn("inline-flex", className)}>{mark}</span>;

  return (
    <span className={cn("inline-flex flex-col items-start gap-2", className)}>
      {mark}
      <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-cf-ink">{sub}</span>
    </span>
  );
}
