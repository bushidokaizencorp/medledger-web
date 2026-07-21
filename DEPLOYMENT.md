# MedLedger — Deployment Runbook

For deploying MedLedger to an internet-accessible server (e.g. your Oracle Cloud
instance) on SQL Server, with the security controls actually switched on.

---

## 1. Provision

- A Linux host (2 vCPU / 4 GB RAM is comfortable for a first deployment).
- Docker + Docker Compose plugin.
- A domain name pointed at the host (e.g. `erp.bushidokaizencorporation.com`).
- Ports: expose only 443 (HTTPS) publicly. Keep 1433 (SQL Server) private.

## 2. Configure secrets

```bash
cp .env.example .env
```

Set, at minimum:

- `JWT_SECRET` — `openssl rand -hex 32`
- `DB_PASSWORD` — a strong SA password (SQL Server requires upper/lower/digit/symbol)
- `CORS_ORIGINS` — your real frontend origin, e.g. `https://erp.bushidokaizencorporation.com`
- `COOKIE_SECURE=true`
- `NODE_ENV=production`

The app **refuses to boot in production** with the default JWT secret or an
incomplete SQL Server config — that is intentional.

## 3. Bring up the stack

```bash
docker compose up -d
docker compose exec app npm run migrate
docker compose exec app npm run seed        # or: seed -- --minimal (reference only)
```

Verify:

```bash
curl -f http://localhost:8080/healthz
curl -f http://localhost:8080/readyz        # checks the DB connection
```

## 4. Put TLS in front (required)

Run a reverse proxy (Caddy or nginx) terminating TLS and forwarding to the app on
8080. Caddy gives you automatic Let's Encrypt certificates:

```
erp.bushidokaizencorporation.com {
    reverse_proxy localhost:8080
}
```

The app already sets HSTS, CSP and the other security headers in production; TLS
termination completes the picture. Do **not** expose 8080 directly to the internet.

## 5. First-login hardening

- Sign in as `admin@` and immediately change every seeded password.
- Create real named user accounts; disable or delete the shared demo accounts.
- Review roles: ADMIN, FINANCE, HR, PAYROLL, APPROVER, SALES, WAREHOUSE, VIEWER.

## 6. Go-live checklist

**Statutory data**
- [ ] Verify PAYE bands / NSSA ceiling / AIDS levy / ZIMDEF / SDL against the current Finance Act and ZIMRA tables.
- [ ] Verify VAT rates in the VAT posting setup (standard rate, zero-rated, exempt).
- [ ] Confirm your NEC council and its dues.

**Fiscalisation & traceability**
- [ ] Obtain ZIMRA FDMS device registration + certificate; set `FDMS_MODE=live`, `FDMS_BASE_URL`, `FDMS_DEVICE_ID`, and wire the live transport in `src/modules/fiscalisation.service.js` (the payload builder and submission recording are already done).
- [ ] Obtain MCAZ/TRVST EPCIS endpoint access; set `MCAZ_MODE=live`, `MCAZ_BASE_URL`.

**Security**
- [ ] Real `JWT_SECRET`, all seeded passwords changed.
- [ ] `COOKIE_SECURE=true`, TLS enforced, HSTS confirmed.
- [ ] CORS restricted to your frontend origin only.
- [ ] Encrypt PII at rest (employee national ID, NSSA number, bank details; customer TINs). Application-level field encryption or SQL Server Always Encrypted.
- [ ] Firewall: only 443 public; 1433 private to the app network.
- [ ] Set up automated backups of the SQL Server database and **test a restore**.
- [ ] Turn on SQL Server TDE (encryption at rest) if required by policy.

**Operations**
- [ ] Ship logs somewhere durable (the app logs structured JSON, redacting auth headers).
- [ ] Configure the container restart policy (already `unless-stopped` in compose).
- [ ] Parallel-run payroll against your current process for two cycles and reconcile to the cent before switching.

## 7. Migrations on future releases

Schema changes are Knex migrations. On deploy:

```bash
docker compose exec app npm run migrate
```

Migrations are forward-only in production; never edit a shipped migration —
add a new one.

---

## What is NOT included / done yet

Carried over from the reference build, still to port/build on top of this base:
payroll calculation engine and payslip posting (the schema and statutory tables
are here; the calculation service is in the Python reference), leave-request
workflow endpoints, statutory return generation (P2/P6, NSSA schedules), and
the reporting/filter layer (location, date, dimension filters).
