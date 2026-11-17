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
- Audit events are written for login success/failure, logout, password changes, user creation, updates, and deletions.
- Missing `JWT_SECRET` now fails at runtime instead of silently falling back.

## Approved work devices

People can be limited to signing in from work devices an administrator has approved (Admin -> Devices, or the "Work devices" section of a user's profile).

- A device is a passkey created by the computer's own hardware (Touch ID, Windows Hello). The private key cannot be copied off the machine, so a successful check proves the sign-in comes from that machine.
- Passkeys that sync between a person's devices (iCloud Keychain, Google Password Manager) are refused at registration. Safari on macOS only makes synced passkeys, so Macs must register with Chrome and keep the passkey on the device.
- For a person with the rule on, a correct password (or Google sign-in) opens no session. It earns a 10-minute `device_gate` cookie that only reaches `/api/auth/device/*`; the session is created by `/api/auth/device/verify` once an approved device has signed the challenge.
- A new device is stored as `pending` and is unusable until an admin approves it. Revoking a device ends its sessions at once: `lib/auth.ts` checks the device on every request.
- Set `WEBAUTHN_ORIGIN` to the site's public address before switching the rule on in production.
- An admin cannot switch the rule on for themselves without an approved device of their own, and cannot revoke the device they are signed in on.
- Locked out anyway (e.g. the only admin's laptop died)? Clear the rule in the database: `UPDATE "User" SET "requireApprovedDevice" = false WHERE email = '<admin email>';`
- What this does not stop: a session cookie copied from an approved device still works elsewhere until it expires (24 hours) or the device is revoked, and someone with full control of their work computer could register a software authenticator instead of the built-in one. Both need device management (MDM) to close.

## Relevant routes

- `POST /api/auth/device/options`, `POST /api/auth/device/register`, `POST /api/auth/device/verify`
- `GET|PATCH|DELETE /api/admin/devices`, `PUT /api/admin/devices/policy`

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `POST /api/auth/change-password` (self-service, from the sign-in screen: email + current password + new password; revokes all of the account's sessions)
- `GET /api/auth/session`
- `POST /api/admin/users`
- `PUT /api/admin/users/[userId]`
- `DELETE /api/admin/users/[userId]`
- `GET /api/admin/audit`
