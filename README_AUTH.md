# Admin-Managed Access

This project no longer exposes public self-service signup.

Use the bootstrap administrator from `.env` to sign in, then manage users from the admin workspace:

1. Start PostgreSQL with `docker compose up -d postgres`
2. Run `npm run db:migrate -- --name init`
3. Run `npm run db:seed`
4. Sign in with `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD`
5. Create additional users from `/admin`
