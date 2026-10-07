# SMTP email delivery

ClickfieldAI sends transactional email (spec §19-§21) through a pluggable
provider in `backend/app/services/email/`. Three providers implement the same
`EmailProvider.send(to, subject, html_body) -> message_id` interface:

| Provider | Selected when | Behaviour |
|---|---|---|
| `noop` | default; nothing configured | never sends; logs recipient + subject only; `email_logs.provider = 'noop'` |
| `resend` | `EMAIL_PROVIDER=resend` (or auto: `RESEND_API_KEY` set) | Resend HTTP API |
| `smtp` | `EMAIL_PROVIDER=smtp` (or auto: `SMTP_HOST` + `SMTP_FROM_EMAIL` set) | stdlib `smtplib`, STARTTLS or implicit TLS |

There is only one notification pipeline. SMTP plugs into it unchanged:

```
ticket/comment request commits
  -> commit_then_notify() enqueues a job        (app/services/notifications.py)
  -> notification_worker dequeues it             (app/workers/notification_worker.py)
  -> resolves recipients, renders the template   (app/services/email/templates.py)
  -> provider.send()  with retry + exponential backoff (EMAIL_MAX_ATTEMPTS, EMAIL_RETRY_BASE_SECONDS)
  -> every attempt recorded in email_logs
```

Email can never fail or roll back a ticket or comment: the request has already
committed before the job is enqueued, and the worker swallows and records
every provider error.

## Configuration

All variables are **backend/worker only**. Never prefix them with
`NEXT_PUBLIC_`, and never commit real values (`.env.example` holds empty
placeholders). Set them on both the API service and the worker service.

| Variable | Default | Notes |
|---|---|---|
| `EMAIL_PROVIDER` | empty (auto) | `noop`, `resend` or `smtp`. Use `noop` to force-disable sending. |
| `SMTP_HOST` | empty | empty = SMTP not configured |
| `SMTP_PORT` | `587` | `587` for STARTTLS, `465` for implicit TLS |
| `SMTP_USERNAME` | empty | if empty, no `AUTH` is attempted |
| `SMTP_PASSWORD` | empty | secret. Never logged, never stored, never returned by the API |
| `SMTP_FROM_EMAIL` | empty | required for SMTP; must be allowed by your SMTP server |
| `SMTP_FROM_NAME` | `ClickfieldAI Support` | display name in `From:` |
| `SMTP_USE_TLS` | `true` | STARTTLS after connecting (ignored when `SMTP_USE_SSL=true`) |
| `SMTP_USE_SSL` | `false` | implicit TLS from the first byte (port 465) |

If `EMAIL_PROVIDER` names a provider that isn't fully configured (for example
`smtp` without `SMTP_HOST`), the app logs an error and falls back to `noop`.
It never guesses and never crashes on missing email config.

## Dev behaviour (noop fallback)

DEV has no SMTP or Resend credentials, so `get_email_provider()` returns
`NoopEmailProvider`. The worker still runs the whole pipeline: recipients are
resolved, templates rendered, and an `email_logs` row is written with
`provider = 'noop'` and `status = 'SENT'` and a synthetic `noop-<uuid>` message
id. Nothing leaves the machine. These rows are never mistaken for real
deliveries because of the `noop` provider value.

## Verifying a real send locally

Use a throwaway test inbox you create yourself. Do not use production
credentials on a laptop. Any one of these works:

- **Mailtrap** (sandbox inbox): create an inbox, copy its SMTP host, port,
  username and password.
- **Ethereal** (https://ethereal.email): click "Create Ethereal Account" to get
  a disposable SMTP login. Messages are captured, never delivered.
- **Gmail with an App Password**: needs 2-Step Verification. Generate an app
  password, then use `smtp.gmail.com:587`, `SMTP_USE_TLS=true`, your Gmail
  address as username and `SMTP_FROM_EMAIL`.

Then, in `backend/.env` (gitignored):

```
EMAIL_PROVIDER=smtp
SMTP_HOST=sandbox.smtp.mailtrap.io
SMTP_PORT=587
SMTP_USERNAME=<from your test inbox>
SMTP_PASSWORD=<from your test inbox>
SMTP_FROM_EMAIL=support@example.com
SMTP_USE_TLS=true
```

Start the API and the worker (`python -m app.workers.notification_worker`),
then reply on a ticket as staff. The client should receive a
"[ClickfieldAI] New Reply" email in the test inbox. Check the audit trail:

```sql
select created_at, recipient, notification_type, provider, status, attempt_count, error_message
from email_logs order by created_at desc limit 20;
```

## email_logs: the delivery audit trail

One row per (ticket event, recipient). Columns: `recipient`,
`notification_type`, `provider` (`noop` / `resend` / `smtp`), `status`
(`PENDING` while retrying, then `SENT` or `FAILED`), `attempt_count`,
`provider_message_id` (SMTP: the generated `Message-ID`), `error_message`,
`sent_at`. Rows are written by the worker through the narrowly scoped
privileged helpers in `app/core/privileged.py`. Monitor for
`status = 'FAILED'`.

## Credential safety

- `SmtpEmailProvider` builds its error messages from the exception type and the
  SMTP status code only, never from `str(exc)` (servers sometimes echo the
  login back) and never from the username or password. It also raises with
  `from None`, so no chained exception carrying smtplib's text reaches a log.
- `repr(provider)` shows only host and port.
- No API route reads SMTP settings. `tests/test_smtp_email.py` and
  `test_team_reply_delivered_via_smtp_provider_without_leaking_credentials`
  (real DEV) assert the password never appears in `email_logs`, in worker logs,
  or in API responses.

## Templates

`app/services/email/templates.py` renders the spec §19 templates with a
ClickfieldAI header and footer. They use a table-based layout with inline
styles only, with no external CSS, fonts or images, so they render in Outlook,
Gmail and mobile clients. Each has an "Open Ticket" button plus a plain link
back into the portal. Templates never include comment or internal-note text.
The recipient opens the portal, where RLS decides what they can see.

## Known limitation

Real SMTP delivery has not been tested end to end against a live server: no
SMTP credentials exist for DEV or PROD yet. The provider is covered by unit
tests with a faked `smtplib` and by a real-DEV worker test that uses the
same fake transport.
