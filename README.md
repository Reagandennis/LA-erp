# LA-ERP

LA-ERP is a Next.js 16 App Router application with:

- PostgreSQL via Prisma
- Revocable JWT-backed sessions stored in the database
- Administrator-managed accounts only
- Server-enforced role and permission checks
- Audit visibility for auth and admin actions

## Local setup

1. Copy the environment template:

```bash
cp .env.example .env
```

2. Start PostgreSQL:

```bash
docker compose up -d postgres
```

3. Install dependencies:

```bash
npm install
```

4. Generate the Prisma client and apply migrations:

```bash
npm run db:generate
npm run db:migrate -- --name init
```

5. Seed the RBAC baseline and bootstrap admin:

```bash
npm run db:seed
```

6. Start the app:

```bash
npm run dev
```

## Environment variables

`.env.example` defines the required values:

- `DATABASE_URL`
- `JWT_SECRET`
- `BOOTSTRAP_ADMIN_EMAIL`
- `BOOTSTRAP_ADMIN_NAME`
- `BOOTSTRAP_ADMIN_PASSWORD`

The seed step creates or updates the bootstrap administrator from those values.

## Core scripts

```bash
npm run dev
npm run build
npm run lint
npm run test
npm run db:generate
npm run db:migrate -- --name init
npm run db:seed
```

## Access model

- Public self-signup is disabled.
- Accounts are created from the admin workspace.
- `/dashboard` and `/admin` are optimistically gated by `proxy.ts`.
- Route handlers still perform final authorization checks against the database.

## Verification

The current automated checks are:

```bash
npm run lint
npm run build
npm run test
```
