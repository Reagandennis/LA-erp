# Security Policy — LA-ERP

> Maintained by [Reagan Enoch Owiti](https://github.com/Reagandennis) · Fleet & Vehicle Management System

---

## Supported Versions

The following versions of LA-ERP currently receive security updates. Deployments on unsupported versions are strongly encouraged to upgrade before reporting vulnerabilities.

| Version | Supported          | Notes                          |
| ------- | ------------------ | ------------------------------ |
| 1.x (current) | ✅ Active    | Full security support          |
| < 1.0 (beta)  | ❌            | No longer maintained           |

> Version support windows are reviewed quarterly. Users will receive at least **90 days' notice** before a version loses security support.

---

## Scope

This policy covers security vulnerabilities in:

- The LA-ERP web application (fleet management dashboard, trip tracking, inspection modules)
- The LA-ERP REST API
- Authentication and session management
- Vehicle/GPS data handling and storage
- Integration layers (Traccar, WhatsApp Business API, NocoDB, and any configured data sources)
- Mobile companion apps (if applicable)

**Out of scope:**
- Vulnerabilities in third-party services (Traccar, Cloudflare, flespi, wacli) — report these directly to those vendors
- Social engineering attacks targeting users
- Issues already publicly disclosed
- Bugs with no security impact (use the standard issue tracker instead)

---

## Reporting a Vulnerability

We take security issues seriously. If you discover a vulnerability in LA-ERP, please report it responsibly — **do not open a public GitHub issue**.

### How to Report

**Preferred channel:** Email **security@techgetafrica.com** with the subject line:

```
[LA-ERP SECURITY] <Brief description of the problem>
```

**Alternative:** Use GitHub's private [Security Advisories](../../security/advisories/new) feature if enabled on this repository.

### What to Include

Please provide as much of the following as possible:

- **Description** — What is the vulnerability and what impact does it have?
- **Affected version(s)** — Which LA-ERP version did you test against?
- **Steps to reproduce** — A clear, minimal reproduction path (screenshots, curl commands, or a PoC are helpful)
- **CVSS score estimate** — Optional, but appreciated
- **Suggested fix** — If you have one

### Encryption

For sensitive disclosures, you may request our PGP public key at **security@techgetafrica.com** before sending details.

---

## Response Timeline

| Milestone                          | Target Timeframe              |
| ---------------------------------- | ----------------------------- |
| Acknowledgement of report received | Within **48 hours**           |
| Initial severity assessment        | Within **5 business days**    |
| Status update (accepted/declined)  | Within **10 business days**   |
| Patch release (critical/high)      | Within **30 days** of triage  |
| Patch release (medium/low)         | Within **90 days** of triage  |
| Public disclosure                  | After patch is released       |

We follow a **coordinated disclosure** model. We ask that you give us reasonable time to remediate before any public disclosure.

---

## Severity Classification

We use the following severity levels, aligned with CVSS v3.1:

| Severity | CVSS Score | Examples in LA-ERP Context                                      |
| -------- | ---------- | --------------------------------------------------------------- |
| Critical | 9.0–10.0   | Unauthenticated RCE, full database dump, auth bypass            |
| High     | 7.0–8.9    | Privilege escalation, fleet data exposure across tenants        |
| Medium   | 4.0–6.9    | IDOR on vehicle records, stored XSS, session fixation           |
| Low      | 0.1–3.9    | Information disclosure, minor input validation issues           |

---

## What Happens After You Report

**If the vulnerability is accepted:**
- You will receive a confirmation with an internal tracking ID
- We will work with you on timeline and any clarifications needed
- Once patched, you will be notified and offered acknowledgement in our release notes (with your permission)
- We do not currently offer a bug bounty programme, but we acknowledge all confirmed reporters

**If the vulnerability is declined:**
- We will provide a clear explanation of why (e.g., out of scope, not reproducible, known/accepted risk)
- You may appeal by replying with additional evidence

---

## Security Best Practices for Operators

If you are self-hosting LA-ERP, please follow these guidelines:

- **Keep LA-ERP updated** to the latest supported version
- **Use HTTPS** — enforce TLS via your reverse proxy (Traefik, Nginx, etc.)
- **Restrict admin routes** — place `/admin` behind IP allowlist or VPN where possible
- **Rotate API keys** periodically and revoke unused credentials
- **Enable audit logging** for all authentication events
- **Backup your database** regularly and test restore procedures
- **Configure Cloudflare or equivalent WAF** in front of public-facing instances
- **Use strong, unique passwords** and enable MFA for all admin accounts

---

## Responsible Disclosure Commitment

I commits to:

- Responding to all reports in good faith
- Not pursuing legal action against researchers who act responsibly and follow this policy
- Crediting researchers who disclose responsibly (unless anonymity is requested)
- Keeping reporters informed at each stage of remediation

---

## Contact

| Channel         | Address / Link                        |
| --------------- | ------------------------------------- |
| Security email  | security@techgetafrica.com            |
| General support | support@techgetafrica.com             |
| Website         | https://portfolio-reagan.reaganprezzo.workers.dev/#about |

---

*Last updated: June 2026 · LA-ERP v1.x · Maintained by Reagan Enoch Owiti*
