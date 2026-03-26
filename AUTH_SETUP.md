# Authentication and Authorization

## Current architecture

- Session cookies contain a signed JWT with the user id, session id, and session version.
- Active sessions live in PostgreSQL and are revoked on logout, role changes, and status changes.
- `proxy.ts` performs optimistic cookie-based redirects for protected pages.
- Route handlers perform final authorization checks with live database state.

## Account lifecycle

- Public account registration is disabled.
- Administrators create accounts from `/admin`.
- Role changes and status changes revoke existing sessions immediately.
- The last administrator cannot be deleted or demoted.

## Security controls in this repo

- Passwords are hashed with `bcryptjs`.
- Authentication and admin mutation routes are rate limited through the database.
- Audit events are written for login success/failure, logout, user creation, updates, and deletions.
- Missing `JWT_SECRET` now fails at runtime instead of silently falling back.

## Relevant routes

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/session`
- `POST /api/admin/users`
- `PUT /api/admin/users/[userId]`
- `DELETE /api/admin/users/[userId]`
- `GET /api/admin/audit`
