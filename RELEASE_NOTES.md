# LA-ERP v1.1.0

_Fleet & operations ERP — release notes_

This release builds on v1.0.0 with a CRM and sales pipeline, QuickBooks integration, an invoice approval workflow, a redesigned admin console, and a broad security-hardening pass. It is backward compatible; the only operational step is running database migrations on deploy.

## Highlights

- **CRM & sales pipeline** — customers, deals, and activities, wired into quotes and invoices.
- **QuickBooks integration** — connect an account via OAuth and sync invoicing data.
- **Invoice approval workflow** — submit, approve/decline, send, and record payments, with notifications.
- **Redesigned admin console** — Overview, Users, Roles, Audit, and a new Settings tab.
- **Security hardening** — safe file serving, security headers, per-user rate limits, and admin-tunable upload limits.

## New features

### CRM & sales pipeline
- Customers, deals (with stages), and a CRM activity feed.
- Deal-to-quote and quote-to-invoice linkage so a sale carries through to billing.

### QuickBooks
- OAuth connect/callback flow with CSRF-protected state, connection status, and disconnect.
- Access gated to admins or holders of the invoicing module.

### Invoices
- Approval lifecycle: draft → submit → approve/decline → send, plus payment recording.
- In-app notifications for each step.

### Quotes
- Reusable quote templates and brand profiles (per-brand logos) for generated PDFs.

### Admin console
- **Password reset** — admins can set a new password for any user from the user drawer; the target's other sessions are revoked (an admin resetting their own password keeps the current session).
- **Upload limits (Settings tab)** — adjust the maximum size (1–100 MB) for five upload categories: files & attachments, photos, documents, radio audio, and logos. Changes apply immediately across the app and are recorded in the audit log.
- **Audit log** — server-side filtering (search, action, entity, actor, date range), pagination, a detail drawer, and CSV export.

### Modules
- New/expanded modules: contacts, SOPs, contracts, driver-licence tracking, personnel, notes, due-dates, shift handover, and a map/flight-tracking view.

## Security

This release closes the findings from a full API audit.

- **Safe file serving** — user-uploaded content is served through a single hardened path: only known-safe types (common images, PDF, plain text) render inline; everything else downloads as `application/octet-stream` with `X-Content-Type-Options: nosniff`. SVG uploads are rejected. This removes a stored-XSS vector.
- **Security headers** — `next.config.ts` now emits `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, HSTS, and a Content-Security-Policy (shipped in Report-Only mode initially so the Google Maps and Sign-In sources can be tuned before enforcement).
- **Rate limiting** — per-user limits added to the AI assistant, Zello transcription, the FlightRadar proxy, and file uploads, alongside the existing login limits.
- **Directory-enumeration fix** — the user-mentions endpoint now requires a search term and caps results, instead of returning every user's email.
- **Upload caps** — every upload route enforces a size limit (previously one path had none), now sourced from the admin-configurable settings.
- **Auth** — JWT verification pins the HS256 algorithm; a `requireModuleRequest` guard was added for per-module route authorization.
- **Secrets** — repository history was rewritten to purge a previously committed environment file. **Operators must rotate any credentials that were ever committed** (see Upgrade notes).

## Upgrade notes

- **Run migrations.** This release adds the `UploadLimitSettings` table (migration `20260809153839_upload_limit_settings`) plus the CRM, QuickBooks, and invoice-approval migrations. Deploys run `prisma migrate deploy` automatically; for manual installs run it before starting the app. Upload limits self-seed to the previous defaults (25/8/10/12/1 MB), so behavior is unchanged until an admin edits them.
- **Rotate credentials.** If you ran any earlier version, rotate `GEMINI_API_KEY`, `FR24_API_TOKEN`, `WHATSAPP_ACCESS_TOKEN`, the Google Maps key (add HTTP-referrer restrictions), and the database password. History rewriting does not protect clones made before this release.
- **CSP tuning.** The Content-Security-Policy ships as `Content-Security-Policy-Report-Only`. Confirm the Google Maps and Sign-In flows raise no violations in the browser console, then rename the header to `Content-Security-Policy` to enforce it.
- **Reverse-proxy body size.** If you raise upload limits, ensure your reverse proxy (Caddy) allows a request body at least that large, or uploads will be rejected before reaching the app.

## Known issues

- **Dependency advisories.** Several dependencies (including Next.js and `sharp`) have published advisories. A follow-up will bump Next.js and run `npm audit fix`; until then, apply your own dependency updates as needed.
- Module-level authorization is enforced on the routes covered above; a broader pass to gate every module route and add object-ownership checks on shared CRM/intel records is planned for a follow-up release.
