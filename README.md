# LA-ERP

**LA-ERP** is a modular, role-controlled operations platform that brings sales,
finance, fleet, workforce, communication, and compliance into a single
dashboard. It ships with **43 built-in modules** that administrators enable per
role, so every user sees only the tools they're meant to use.

Built on **Next.js 16** (App Router), **React 19**, **TypeScript**, and
**PostgreSQL** via **Prisma**.

---

## Table of contents

- [Highlights](#highlights)
- [Tech stack](#tech-stack)
- [Modules](#modules)
- [Architecture](#architecture)
- [Project structure](#project-structure)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [Database & Prisma](#database--prisma)
- [Authentication & access model](#authentication--access-model)
- [API overview](#api-overview)
- [Optional integrations](#optional-integrations)
- [Scripts](#scripts)
- [Testing & verification](#testing--verification)
- [Deployment](#deployment)
- [Conventions](#conventions)

---

## Highlights

- **Secure by default** — revocable, database-backed JWT sessions; no public
  self-signup; accounts are created and managed by administrators.
- **Hardened surface** — security response headers (CSP, HSTS, frame/sniff
  protection), safe serving of user-uploaded files, per-user rate limits, and
  admin-tunable upload size limits.
- **Role & permission control** — every action is checked server-side against
  the user's role and permissions (RBAC).
- **Sales-to-cash** — a CRM pipeline (customers, deals, activities) that flows
  into quotes, then into invoices with an approval workflow and optional
  QuickBooks sync.
- **Audit visibility** — authentication and admin actions are recorded to an
  audit log with server-side filtering and CSV export.
- **Real-time** — live updates and in-app notifications across modules.
- **Modular** — 43 modules across 13 categories, enabled per role.
- **Document generation** — branded PDF quotes and invoices via
  `@react-pdf/renderer`.

---

## Tech stack

| Layer            | Technology                                                |
| ---------------- | --------------------------------------------------------- |
| Framework        | Next.js 16 (App Router), React 19                         |
| Language         | TypeScript 5                                              |
| Database         | PostgreSQL 16                                             |
| ORM              | Prisma 6                                                  |
| Styling          | Tailwind CSS 4                                            |
| Validation       | Zod                                                       |
| Auth             | `jsonwebtoken` (JWT) + `bcryptjs` (password hashing)      |
| PDF              | `@react-pdf/renderer`                                     |
| Images           | `sharp`                                                   |
| Testing          | Vitest (+ V8 coverage)                                    |

**Prerequisites:** Node.js 20+, npm, and Docker (for local PostgreSQL).

---

## Modules

All modules are defined in [`lib/module-catalog.ts`](lib/module-catalog.ts) and
seeded into the database. Administrators grant module access per role.

### Sales
- **Quotes** — quotation builder with approval workflow, line-item catalogue,
  discounts, multi-currency, custom terms, reusable templates, branded PDF
  export, and multi-company brand profiles.
- **Products / Services** — catalogue of commercial items used in quotes and
  invoices.

### Finance
- **Invoices** — create and send client invoices with an approval workflow
  (submit → approve/decline → send), record payments, track overdue balances,
  generate PDFs, create invoices from approved quotes, and optionally sync with
  QuickBooks Online.
- **Customers** — CRM and accounts-receivable in one: customer accounts, a deal
  pipeline with stages, an activity feed, plus balances, overdue ageing, and
  statements.

### Operations
- **Trip Planning** — turn approved quotes into scheduled trips with
  itineraries, timeline views, and reminders.
- **Task List** — operational tasks and completion status.
- **Task Log – Entry** — record completed work and field accountability logs.
- **Map** — locations, assignments, and routing activity.

### Fleet
- **Vehicles** — fleet records, assignment, and oversight.

### Workforce & Time
- **Personnel** — team records, workforce details, and assignments.
- **Clock-in / out** — attendance and shift punches.
- **Clock** — live, shift-aware working-time display.
- **Countdown Timer** — deadlines and timed operational windows.

### Communication
- **Communication** — internal operational messaging.
- **WhatsApp** — WhatsApp-linked conversations and replies.
- **Telegram** — Telegram bot conversations and group chats.
- **Signal** — Signal direct messages and groups via a linked account.
- **Radio / Zello** — dispatch-style push-to-talk voice workflows.
- **Phone** — calling workflows and call activity.
- **Contact List** — operational contacts and external relationships.
- **Bulletin Board** — announcements, alerts, and operational notices.
- **Feedback** — internal feedback, issues, and improvement requests.
- **AI Chatbot** — AI-assisted search, drafting, and operational help.

### Productivity & Planning
- **To-do List (Personal)** — personal priorities and reminders.
- **To-do List (Group)** — shared team tasks with ownership.
- **Notes** — quick notes and operational context.
- **Calendar** — day / week / month scheduling.

### Procurement
- **Vendors / Suppliers** — supplier profiles, contacts, and relationships.

### Compliance
- **Access to SOPs** — controlled access to standard operating procedures.
- **Notification Center** — deadlines requiring action soon.
- **Drivers License Expiry** — licensing expiry and renewal tracking.
- **Certificate Expiry** — certificate validity and renewal schedules.
- **Contract Renewal** — contract terms and renewal windows.

### Files
- **File Upload** — operational documents, forms, images, and evidence.
- **Storage / Google Drive** — shared files and Drive-linked assets.

### Insights
- **Reports** — reporting outputs, exports, and summaries.
- **KPIs** — headline business and operational indicators.
- **Sales Metrics / KPIs** — pipeline, conversion, and commercial performance.
- **Finance Metrics / KPIs** — financial health and accounting indicators.
- **Filters** — saved views and custom data slices.

### Tools
- **Weather** — forecasts for operational planning.
- **Flight Tracker** — flight status and schedules for logistics and travel.

---

## Architecture

- **App Router** — all routes live under `app/`. UI pages, API route handlers,
  and per-module front-ends are colocated.
- **Domain logic in `lib/`** — business logic (quotes, invoices, accounts,
  trips, auth, RBAC, etc.) is kept out of route handlers and UI, server-only
  where appropriate.
- **Two-stage authorization:**
  1. `proxy.ts` performs optimistic, cookie-based redirects for protected pages
     (`/dashboard`, `/admin`).
  2. Route handlers perform the **final** authorization check against live
     database state — the proxy is a convenience, not the security boundary.
- **Sessions in the database** — JWTs reference a server-side session row that
  can be revoked at any time (logout, role change, status change).
- **Validation at the edge** — request payloads are validated with Zod before
  they reach domain logic.
- **Hardened responses** — security headers (CSP, HSTS, `X-Frame-Options`,
  `X-Content-Type-Options`) are set in `next.config.ts`; user-uploaded files are
  served through `lib/file-response.ts`, which forces unknown types to download
  rather than render inline; expensive routes are rate-limited via the database.

---

## Project structure

```
app/
  admin/         Admin workspace (user management, audit)
  api/           Route handlers (see API overview)
  auth/          Sign-in flow
  dashboard/     Authenticated dashboard shell
  modules/       Per-module front-ends (43 modules + _components)
  ui/            Shared UI primitives
  layout.tsx     Root layout
  globals.css    Tailwind entry
lib/             Domain logic, auth, RBAC, PDF, integrations
prisma/
  schema.prisma  Data model (~50 models)
  migrations/    Ordered SQL migrations
  seed.ts        RBAC + module + bootstrap-admin seed
tests/           Vitest suites
public/          Static assets
```

---

## Getting started

```bash
# 1. Environment
cp .env.example .env        # then fill in the values (see below)

# 2. Database (PostgreSQL 16) and the wacli WhatsApp bridge, via Docker
docker compose up -d

# 3. Dependencies
npm install

# 4. Prisma client + schema
npm run db:generate
npm run db:migrate -- --name init

# 5. Seed RBAC baseline, modules, and the bootstrap admin
npm run db:seed

# 6. Run
npm run dev
```

The app starts on [http://localhost:3000](http://localhost:3000). Sign in with
the `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` you set in `.env`, then
create additional users from `/admin`.

> The bundled `docker-compose.yml` exposes PostgreSQL on host port **5433**
> (database/user/password all `la_erp`). Set `DATABASE_URL` accordingly, e.g.
> `postgresql://la_erp:la_erp@localhost:5433/la_erp`.

---

## Environment variables

### Required

| Variable                  | Description                                          |
| ------------------------- | ---------------------------------------------------- |
| `DATABASE_URL`            | PostgreSQL connection string                         |
| `JWT_SECRET`              | Secret for signing session JWTs (fails fast if unset)|
| `BOOTSTRAP_ADMIN_EMAIL`   | Email for the seeded administrator                   |
| `BOOTSTRAP_ADMIN_NAME`    | Display name for the seeded administrator            |
| `BOOTSTRAP_ADMIN_PASSWORD`| Password for the seeded administrator                |

The seed step creates or updates the bootstrap administrator from these values.

### Optional (per module)

| Variable                          | Used by             |
| --------------------------------- | ------------------- |
| `GEMINI_API_KEY`, `GEMINI_MODEL`  | AI Chatbot          |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Map                 |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID`    | Storage / Google Drive |
| `FR24_API_TOKEN`                  | Flight Tracker (FlightRadar24) |
| `OPENSKY_USERNAME`, `OPENSKY_PASSWORD` | Flight Tracker (OpenSky)  |
| `ZELLO_*`                         | Radio / Zello (see below) |
| `WACLI_CONTAINER`                 | WhatsApp (name of the bundled wacli Docker container, `la-erp-wacli`) |
| `WACLI_BIN`                       | WhatsApp (path to a host-installed `wacli` binary, used when `WACLI_CONTAINER` is empty) |
| `WACLI_WEBHOOK_BASE`              | WhatsApp (override for the URL `wacli sync` posts inbound messages to) |
| `TELEGRAM_API_ID`, `TELEGRAM_API_HASH` | Telegram (app credentials from my.telegram.org) |
| `TELEGRAM_API_ID`, `TELEGRAM_API_HASH` | Telegram (app credentials from my.telegram.org) |
| `SIGNAL_CLI_BIN`                  | Signal (path to `signal-cli`; accounts are linked per user) |
| `QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_CLIENT_SECRET` | QuickBooks Online integration |
| `QUICKBOOKS_REDIRECT_URI`, `QUICKBOOKS_ENVIRONMENT` | QuickBooks OAuth callback & `sandbox`/`production` |
| `WAVE_CLIENT_ID`, `WAVE_CLIENT_SECRET` | Wave (waveapps.com) accounting — per-brand sync |
| `WAVE_REDIRECT_URI`, `WAVE_BUSINESS_ID` | Wave OAuth callback & optional business pin |

Modules whose integration variables are unset degrade gracefully — they remain
visible but report that they need configuration.

---

## Database & Prisma

The data model lives in [`prisma/schema.prisma`](prisma/schema.prisma) (~50
models). Major groups:

- **Identity & access** — `User`, `Role`, `Permission`, `RolePermission`,
  `UserRole`, `Module`, `UserModule`, `Session`, `AuditLog`, `RateLimitBucket`,
  `UploadLimitSettings`.
- **Sales & finance** — `Customer`, `Deal`, `CrmActivity`, `Quote`, `QuoteItem`,
  `QuoteTemplate`, `Product`, `BrandProfile`, `Invoice`, `InvoiceItem`,
  `InvoicePayment`, `QuickBooksConnection`, plus `*Sequence` models for
  human-readable numbering.
- **Operations** — `Trip`, `TripItineraryItem`, `ScheduleShift`,
  `DriverLicense`.
- **Communication** — `Conversation`, `ConversationMember`, `Message`,
  `Feedback`, `ZelloActivity`, `WhatsAppMessage`, plus `*Notification` models.
- **Productivity & files** — `PersonalTodo` (+ attachments, shares, comments,
  boards), `CalendarEvent`, `StoredFile`.

Common commands:

```bash
npm run db:generate              # regenerate the Prisma client
npm run db:migrate -- --name x   # create & apply a migration in dev
npm run db:seed                  # seed roles, permissions, modules, admin
```

---

## Authentication & access model

- **Admin-managed accounts only.** Public registration is disabled; admins
  create accounts from `/admin`.
- **Sessions:** the session cookie holds a signed JWT (user id, session id,
  session version). Active sessions live in PostgreSQL and are revoked on
  logout, role change, and status change.
- **Roles** (seeded in [`lib/rbac.ts`](lib/rbac.ts)):
  - `admin` — full platform access (all permissions).
  - `editor` — create / read / update business content.
  - `viewer` — read-only access to assigned content.
- **Permissions:** `user:create/read/update/delete`, `role:manage`,
  `audit:read`, `content:create/read/update/delete`.
- **Admin controls (`/admin`):** create, suspend, and delete users; assign roles
  and modules; **reset any user's password** (which revokes the target's other
  sessions); adjust **upload size limits** per category from the Settings tab;
  and review the audit log.
- **Safeguards:** passwords hashed with `bcryptjs`; auth and admin mutation
  routes are rate-limited via the database; audit events written for login
  success/failure, logout, user create/update/delete, password resets, and
  upload-limit changes; the last administrator cannot be deleted or demoted.

---

## API overview

Route handlers live under `app/api/`, grouped by domain:

| Group            | Purpose                                       |
| ---------------- | --------------------------------------------- |
| `auth`           | Login, logout, session                        |
| `admin`          | User management, password reset, upload limits, audit log |
| `users`          | User-facing account operations                |
| `crm`            | Customers, deals, and activities              |
| `quickbooks`     | QuickBooks OAuth connect, status, disconnect  |
| `quotes`         | Quotes, customers, products, templates, brand profiles, PDF |
| `invoices`       | Invoices, approval workflow, payments, PDF, create-from-quote |
| `trips`          | Trip planning & itineraries                   |
| `planning`       | Scheduling                                    |
| `calendar`       | Calendar events                               |
| `clock-in-out`   | Attendance punches                            |
| `communication`  | Internal messaging                            |
| `feedback`       | Feedback submissions                          |
| `files`          | File upload & sharing                         |
| `drivers`        | Driver licensing                              |
| `whatsapp`       | WhatsApp inbox (via `wacli`)                  |
| `telegram`       | Telegram inbox (Bot API): status, chats, thread, reply |
| `signal`         | Signal inbox (via `signal-cli`): status, chats, thread, reply |
| `zello`          | Radio / Zello activity                        |
| `flight-tracker`, `flight-radar` | Flight status / tracking      |
| `ai-chatbot`     | AI assistant                                  |

Example auth routes: `POST /api/auth/login`, `POST /api/auth/logout`,
`GET /api/auth/session`; admin routes: `POST /api/admin/users`,
`PUT /api/admin/users/[userId]`, `DELETE /api/admin/users/[userId]`,
`GET /api/admin/audit`.

---

## Optional integrations

### Radio / Zello
Configure via `ZELLO_*` environment variables (network, channel, credentials,
issuer/private key for token auth) or in-browser settings. Relevant variables:
`ZELLO_NETWORK`, `ZELLO_CHANNEL`, `ZELLO_USERNAME`, `ZELLO_PASSWORD`,
`ZELLO_API_KEY`, `ZELLO_ISSUER`, `ZELLO_PRIVATE_KEY`, `ZELLO_RETENTION_DAYS`,
`ZELLO_TRANSCRIBE_MODEL`.

### Messaging (WhatsApp · Telegram · Signal)

All three work the same way: **each user links their own account** by scanning a
QR code from inside the module — no server CLI, no shared inbox. A conversation
is only ever visible to the person whose account received it, and there is no
admin override on the message routes.

| Provider | Linked with | Server prerequisite |
| --- | --- | --- |
| WhatsApp | QR → WhatsApp → Linked devices | the bundled `wacli` Docker container (`WACLI_CONTAINER=la-erp-wacli`), or the `wacli` binary on the host (`WACLI_BIN`) |
| Signal | QR → Signal → Linked devices | the `signal-cli` binary (`SIGNAL_CLI_BIN` if not on PATH) |
| Telegram | QR → Telegram → Devices, or phone + code | `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` from [my.telegram.org](https://my.telegram.org) |

Photos, video, audio and documents work in both directions on all three;
attachments are streamed through `GET /api/<provider>/media` behind the same
permission check, never inlined into the thread JSON.

**Architecture.** Conversations are mirrored into Postgres (`MessagingChat` /
`MessagingMessage`) and the UI reads only from there, so opening a module is a
single indexed query rather than a CLI round-trip. Providers write into the
mirror from background ingest, never on a request path:

| Provider | How messages arrive | Live? |
| --- | --- | --- |
| WhatsApp | `wacli sync --follow --webhook` POSTs each message to `/api/messaging/webhook` | yes, push |
| Telegram | MTProto update stream on the signed-in client | yes, push |
| Signal | background `receive` loop every 10s (the queue has no push channel) | ~10s |

New messages reach the browser over SSE at `/api/messaging/stream`; the event
carries only the affected chat ids and the client refetches from Postgres, so a
dropped or duplicated event can't corrupt the view. The old 4s/8s polling is
gone — a 60s tick remains only as a safety net for a dropped stream.

This also fixes a correctness bug: `signal-cli receive` *pops* messages off the
server queue, and it used to run inside every HTTP request. A request that died
mid-drain lost those messages permanently. Ingest now writes them to Postgres
before anything else can interrupt.

**Operational note.** WhatsApp still needs a long-lived `wacli sync --follow`
process *per linked account*. `instrumentation.ts` starts one for every linked
account at boot and restarts them with backoff; they stop when an account is
unlinked. Plan host memory accordingly: N linked users means N wacli processes.
Telegram holds one MTProto connection per signed-in user; Signal spawns a short
`receive` per tick.

**wacli in Docker.** `docker-compose.yml` ships wacli as the `wacli` service
(built from `docker/wacli/Dockerfile`, pinned to a release, sessions on the
`la-erp-wacli-data` volume). With `WACLI_CONTAINER=la-erp-wacli` in `.env` the
app runs every wacli command inside that container via `docker exec`
(`lib/wacli-runtime.ts`), stops sync/auth processes *inside* the container
rather than just their exec client, and streams attachments through
stdin/stdout so nothing is bind-mounted. At boot the app starts the container
if it is stopped or not yet created; `deploy.sh` builds the image and brings it
up before restarting the app. Requirements: the user the app runs as can run
`docker`, the app listens on `0.0.0.0` (the default for `next start`) so the
container can reach `host.docker.internal:3000` for the webhook, and the
service's working directory is the repo so `docker-compose.yml` is found (or
set `COMPOSE_FILE`). Back up the `la-erp-wacli-data` volume alongside the
database — it holds the linked WhatsApp sessions. To use a host-installed
binary instead, leave `WACLI_CONTAINER` empty and set `WACLI_BIN`.

Telegram accounts with two-step verification cannot complete a QR login — the
module offers phone → code → password sign-in for those. Telegram serves history
from its own servers, so it survives restarts; Signal's queue is drain-once, so
its history is what the app has seen while running.

### AI Chatbot
Set `GEMINI_API_KEY` (and optionally `GEMINI_MODEL`) to enable AI-assisted
search and drafting.

### QuickBooks Online
Set `QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_CLIENT_SECRET`, `QUICKBOOKS_REDIRECT_URI`,
and `QUICKBOOKS_ENVIRONMENT` (`sandbox` or `production`). An admin (or a holder of
the invoicing module) connects an account via OAuth from the app; the connection
is stored per-organization and can be disconnected at any time.

### Wave (waveapps.com)
Accounting sync is **per-brand**: on each brand profile (Quotes → Settings → Brand
profiles) an admin picks an **Accounting sync** provider — `None`, `QuickBooks`, or
`Wave`. Brands set to Wave push their invoices (and quotes as estimates) to Wave
when the document is **sent**, with a manual re-sync available; other brands keep
using QuickBooks.

Requires a **paid Wave plan** (free "Starter" accounts can't authorize third-party
API access) and an OAuth app registered at
[developer.waveapps.com](https://developer.waveapps.com). Set `WAVE_CLIENT_ID`,
`WAVE_CLIENT_SECRET`, `WAVE_REDIRECT_URI` (and optionally `WAVE_BUSINESS_ID`), then
click **Connect Wave** in the Invoices module.

---

## Scripts

```bash
npm run dev          # start the dev server
npm run build        # production build
npm run start        # run the production build
npm run lint         # ESLint
npm run test         # Vitest with coverage
npm run db:generate  # prisma generate
npm run db:migrate   # prisma migrate dev
npm run db:seed      # seed RBAC, modules, and bootstrap admin
```

---

## Testing & verification

The automated checks for this repository are:

```bash
npm run lint
npm run build
npm run test
```

Tests live in `tests/` and run on Vitest.

---

## Deployment

1. Provision a PostgreSQL database and set `DATABASE_URL`.
2. Set a strong `JWT_SECRET` and the `BOOTSTRAP_ADMIN_*` values.
3. Apply migrations: `npx prisma migrate deploy`.
4. Seed once: `npm run db:seed`.
5. Build and start: `npm run build && npm run start`.

Configure any optional integration variables for the modules you intend to use.

**Hardening notes:**

- The Content-Security-Policy in `next.config.ts` ships as
  `Content-Security-Policy-Report-Only`. Verify the Google Maps and Sign-In
  flows raise no violations in the browser console, then rename the header to
  `Content-Security-Policy` to enforce it.
- If you raise the admin-configurable upload limits, make sure your reverse
  proxy (e.g. Caddy) permits a request body at least that large, or uploads are
  rejected before reaching the app.
- Never commit real secrets. If a credential was ever committed, rotate it —
  removing it from history does not protect clones taken beforehand.

---

## Conventions

- This is **Next.js 16** — APIs and conventions differ from older versions.
  Consult the bundled guides in `node_modules/next/dist/docs/` before changing
  framework-level code, and heed deprecation notices.
- Keep business logic in `lib/`; keep route handlers thin and validation-first
  (Zod).
- Never rely on `proxy.ts` for authorization — enforce it in the route handler
  against the database.
