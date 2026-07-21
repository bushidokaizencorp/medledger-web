# MedLedger ERP

[![CI](https://github.com/YOUR_GITHUB_ORG/medledger-web/actions/workflows/ci.yml/badge.svg)](https://github.com/YOUR_GITHUB_ORG/medledger-web/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](package.json)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-blue.svg)](./CONTRIBUTING.md)

**A product of Bushido Kaizen Corporation (Pvt) Ltd**
*Progress Without End. Reach Without Limits.*

A web-based ERP for the Zimbabwean pharmaceutical and distribution sector.
Node.js full-stack, tested on SQLite, deploys on SQL Server. Sales, inventory,
fiscalisation, traceability, general ledger, HR and payroll — with security
built to OWASP ASVS lines.

Open-sourced by Bushido Kaizen Corporation. See [Project status](#project-status)
below for what's production-tested versus still in progress, and
[Disclaimer](#disclaimer) for the compliance-related caveats that matter if
you're evaluating this for real pharmaceutical or payroll use in Zimbabwe.

---

## Run it locally (zero infrastructure)

Requires Node.js 20+ (built and tested on 22). Uses SQLite locally — no database
server needed.

```bash
npm install
cp .env.example .env          # edit JWT_SECRET; set DB_CLIENT=sqlite3 for local
# in .env for local dev: DB_CLIENT=sqlite3
npm run db:reset              # migrate + seed reference & demo data
npm start                     # http://localhost:8080
```

Open **http://localhost:8080** and sign in:

```
admin@bushidokaizen.co.zw / ChangeMe123!
Also: finance@ · sales@ · hr@ · payroll@ · approver@   (same password)
```

Run the tests:

```bash
npm test        # 25 tests: money, auth/security, sales→GL→fiscalisation
```

---

## What works (all tested)

| Area | Capability |
|------|-----------|
| **Auth & security** | Argon2id hashing, JWT + revocable refresh tokens, account lockout, RBAC, Helmet/CSP, CORS allowlist, rate limiting, Zod validation, audit trail |
| **Sales** | Quotations, invoices, VAT-inclusive/exclusive pricing, prescription control, payments |
| **Posting groups** | Business-Central-style account determination (customer / inventory / VAT posting groups) |
| **Inventory** | Batch/lot tracking, FEFO dispensing, stock movements, never issues expired stock |
| **General Ledger** | Double-entry, balance-enforced posting, period control, reversal-only corrections, trial balance |
| **Fiscalisation** | ZIMRA FDMS submission (simulator mode) — canonical payload, receipt, verification code, QR |
| **Traceability** | GS1 EPCIS 2.0 events (commissioning, dispensing) — MCAZ-ready (simulator mode) |
| **Money** | Integer-cents core; 4-decimal unit prices/costs, 2-decimal documents & GL |

The revenue path runs end to end: **create invoice → issue (FEFO dispense +
balanced GL journal) → fiscalise → trial balance balances.**

---

## Decimal handling

- Unit prices, unit costs and quantities carry **4 decimals** (the values you calculate with).
- Line totals, document totals (invoice / quotation / GRV) and everything posted to the GL are rounded once to **2 decimals** (what you commit).

All money is stored as integers (cents / ten-thousandths) — never floats — so
`0.1 + 0.2` is exactly `0.30`, and 1000 tablets at $0.0125 is exactly $12.50.

---

## Continuous Integration

Every push and pull request to `main` or `develop` runs `.github/workflows/ci.yml`:

1. Checks out the repo, installs dependencies (`npm ci`) on Node 20.x and 22.x.
2. Runs `npm audit --audit-level=high` — fails on high/critical vulnerabilities.
3. Runs migrations against a throwaway SQLite database.
4. Seeds reference + demo data.
5. Runs the full Vitest suite (25 tests).
6. Boots the server in production mode and polls `/healthz` and `/readyz` to confirm it actually starts.
7. Builds the production Docker image.

The build fails on the first red step — you get a signal before you ever touch
the Oracle VM. Update the badge URL above once the repo is pushed to your
GitHub org.

---

## Deploy on SQL Server

Everything is written through Knex in the portable subset, so the same code runs
on SQLite and SQL Server. See **DEPLOYMENT.md** for the full runbook. In short:

```bash
cp .env.example .env    # set DB_CLIENT=mssql, DB_* , a real JWT_SECRET
docker compose up -d
docker compose exec app npm run migrate
docker compose exec app npm run seed
```

---

## ⚠️ Before real use

**Statutory figures are placeholders.** PAYE bands, NSSA, levies and VAT rates
carry the correct structure but the amounts must be verified against the current
Finance Act, ZIMRA tables and the NSSA notice. They live in effective-dated
tables so updating them is a data change, not a code change.

**Fiscalisation and traceability run in simulator mode.** They build the exact
payloads and record every submission, but going live needs your ZIMRA device
credentials/certificate and MCAZ/TRVST endpoint access. Set `FDMS_MODE=live`
and supply credentials when you have them.

See **DEPLOYMENT.md** for the full go-live checklist.

---

## Layout

```
src/
  config/      env validation
  db/          knexfile, migrations (6), seed
  lib/         money (dual-scale), auth (argon2/jwt), http, dates
  middleware/  security (auth/role guards, error handler), validation
  modules/     auth, items, customers, inventory, invoicing, quotations,
               fiscalisation, traceability, gl, sales, posting groups
  app.js       express app + security stack
  server.js    entry point
public/        login + SPA app shell (vanilla JS, no build step)
tests/         25 tests
Dockerfile · docker-compose.yml · .env.example
```

---

## Project status

Built and covered by the automated test suite (25 tests, CI-enforced on every push):

- Auth & security (Argon2id, JWT + refresh revocation, RBAC, rate limiting, audit trail)
- Sales: quotations, invoices, VAT-inclusive/exclusive pricing, prescription control
- BC-style posting groups (customer / inventory / VAT account determination)
- Inventory: batch/lot tracking, FEFO dispensing
- General Ledger: balanced double-entry posting, trial balance, period control
- Fiscalisation (ZIMRA FDMS) and traceability (MCAZ/GS1 EPCIS 2.0) — **simulator mode**

Not yet ported into this codebase (contributions welcome — see
[Contributing](#contributing)):

- Payroll calculation engine and payslip GL posting (the schema and statutory
  rate tables exist in the migrations; the calculation logic itself is not
  yet implemented here)
- Leave-request workflow endpoints
- Statutory return generation (ZIMRA P2/P6, NSSA schedules)
- Reporting/filter layer (location, date-range, and dimension filters on ledgers)
- Live FDMS/MCAZ transport (the payload builders and submission recording are
  complete; the actual network calls are stubbed until real device credentials
  are configured)

## Contributing

Contributions are welcome — bug fixes, new modules, statutory-figure
corrections, or porting the items above. Please read
[CONTRIBUTING.md](./CONTRIBUTING.md) first; this codebase has a few hard
rules (money handling, ledger invariants, migration discipline) worth knowing
before you send a PR.

Security issues should go through [SECURITY.md](./SECURITY.md), not a public
issue.

## Demo credentials are for local evaluation only

`npm run db:reset` seeds demo accounts sharing one password
(`ChangeMe123!`), documented here on purpose so nobody mistakes it for a
hidden default. If you deploy this anywhere reachable over a network,
**rotate every seeded credential and set a real `JWT_SECRET` first** — see
[DEPLOYMENT.md](./DEPLOYMENT.md). The app refuses to start in
`NODE_ENV=production` with the placeholder JWT secret, as a backstop.

## Disclaimer

MedLedger is not affiliated with, endorsed by, or certified by ZIMRA, MCAZ,
NSSA, or any Zimbabwean regulatory body. Statutory figures (PAYE bands, NSSA
rates, VAT rates, levies) shipped in the seed data are structurally correct
but must be independently verified against the current Finance Act and the
relevant regulator's published tables before any real financial or payroll
use — see the `VERIFY` markers throughout `src/db/seed.js`. Fiscalisation and
traceability integrations ship in simulator mode; going live requires your
own device credentials and endpoint access issued directly by ZIMRA/MCAZ.
This software is provided under the MIT License **as is**, without warranty
— see [LICENSE](./LICENSE).

## License

MIT — see [LICENSE](./LICENSE). Copyright © 2026 Bushido Kaizen Corporation
(Pvt) Ltd.
