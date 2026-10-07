# Branding

- **Product name in UI copy, emails and metadata:** `ClickfieldAI` (one word, capital C and AI).
  Data stays as stored. For example, the seeded organization row
  "Clickfield AI" and the spec document's wording are not renamed.
- **Logo:** `frontend/components/ClickfieldLogo.tsx` is the only place logo
  markup lives.
  - `variant="full"`: icon plus "Clickfield**AI**" wordmark (the "AI" uses `brand-600`)
  - `variant="compact"`: icon only
  - `size="sm" | "md" | "lg"`, an optional `sub` caption ("Admin console"), and `className`
  - Used by `AuthCard` (login and forgot-password), the desktop sidebar, the mobile top bar and drawer, and the client top bar.
- **No official logo file exists yet.** The mark is a drawn icon on the
  existing `brand-*` tokens. To use a real logo, add it under
  `frontend/public/` and set `LOGO_MARK_SRC` in `ClickfieldLogo.tsx`.
- **Favicon:** `frontend/app/icon.svg` (Next.js serves it automatically). It is the same mark in `brand-600`.
- **Metadata:** the root layout title is "ClickfieldAI Ticketing System",
  with the template `%s · ClickfieldAI`. Each route segment sets its title
  through a metadata-only `layout.tsx`, because the pages are client components.
- **Emails:** `backend/app/services/email/templates.py` has a branded header
  and footer with the accent `#2557e6` (= `brand-600`). Subjects are prefixed `[ClickfieldAI]`.
- The design tokens in `tailwind.config.ts` and `globals.css` remain the
  single source of truth. Branding adds no new colours.
