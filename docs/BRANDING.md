# Branding

## Official logo

- **File:** `frontend/public/branding/clickfieldai-logo.webp` (1968x798, black
  "ClickfieldAI" wordmark on white). This is the **official asset supplied by
  ClickfieldAI**. It was not generated or redrawn.
- **Usage rules:** never redraw it as text or SVG, recolour it, stretch it, or
  substitute another mark. Keep its aspect ratio, and only ever scale it
  uniformly. The source has wide white margins. The app hides most of that
  margin with a CSS window (`overflow: hidden` plus percentage offsets on the
  same image). This does not crop the file itself. The ink box is 1518x184
  at (222, 294), and the visible window is 1572x236 at (196, 270).
- **Component:** `frontend/components/ClickfieldLogo.tsx` is the only place
  logo markup lives. It renders the file through `next/image`, which generates
  the optimized srcset. Props: `size="sm" | "md" | "lg"` (20, 24 or 36 px tall),
  an optional `sub` caption, `className`, and `priority`.
  - There is no compact or icon-only variant. The sidebar never collapses to an
    icon rail, so one was not needed.
- **Where it appears:** `AuthCard` (login and forgot-password, `lg`), the
  desktop sidebar and mobile drawer (`md`, with an "Admin console" or "Team
  workspace" caption), the mobile top bar (`sm`), the client top bar (`md`,
  "Support portal"), and the OpenGraph image.
- **Public access:** `middleware.ts` excludes `/branding/*`, `/icon.png` and
  `/apple-icon.png` from the auth redirect. Logged-out pages, the image
  optimizer and email clients all need to load them.

## Derivatives (pixel-exact, generated with `sharp` from the official file)

- **Favicon:** `frontend/app/icon.png` (512x512) and `frontend/app/apple-icon.png` (180x180).
  The full wordmark is unreadable at 16 to 32 px. The favicon is the logo's own
  "C" glyph, cropped from the official file and centred on a white square with
  padding. It replaced the earlier placeholder `icon.svg`.
- **Email logo:** `frontend/public/branding/clickfieldai-logo-email.png`
  (480x72). It is the same 1572x236 window as above, exported as PNG, because
  Outlook desktop and some other email clients cannot render WebP.
- To regenerate them, use `sharp` (already a Next.js dependency) with
  `.extract()`/`.resize()` on the official file. Never edit the derivatives by hand.

## Naming

- **Product name:** `ClickfieldAI` (one word, capital C and AI). Data stays
  as stored. For example, the seeded organization row "Clickfield AI" and the
  spec documents in `docs/` are not renamed.
- Use these names by context:
  - **Site and tab title, OpenGraph:** "ClickfieldAI Support Portal". The page
    title template is `%s · ClickfieldAI`. The application name is "ClickfieldAI Support".
  - **Client area:** "Welcome to ClickfieldAI Support" (dashboard). The footer
    of the auth page reads "ClickfieldAI · Client Support Portal".
  - **Team area:** "ClickfieldAI Team".
  - **Admin area:** "ClickfieldAI Operations".
  - **Empty states:** point to the ClickfieldAI team, for example "Create one and the ClickfieldAI team will help".
  - **Emails:** the subject prefix is `[ClickfieldAI]`, the sender name is
    "ClickfieldAI Support" (`SMTP_FROM_NAME`), and the footer reads
    "ClickfieldAI Support Portal".
  - **API:** the FastAPI title is "ClickfieldAI Support API".
- Each route segment sets its title through a metadata-only `layout.tsx`,
  because the pages are client components.

## Emails

`backend/app/services/email/templates.py` sets the header `<img>` to
`settings.app_url + "/branding/clickfieldai-logo-email.png"`. It has
`alt="ClickfieldAI"` and fixed width and height. With a localhost `APP_URL`,
the image does not load and the email shows the alt text, so nothing breaks.
Templates use only inline styles and never include comment or internal-note
text. The accent colour is `#2557e6` (= `brand-600`).

## Known limitations

- Supabase sends the password-reset email itself, using the template set in
  the Supabase dashboard (Auth > Email Templates). This repo cannot change it.
  To brand it, update that template in the dashboard.

The design tokens in `tailwind.config.ts` and `globals.css` remain the single source of truth.
