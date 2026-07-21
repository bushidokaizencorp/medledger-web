# Contributing to MedLedger

Thanks for your interest in contributing. This project is maintained by
Bushido Kaizen Corporation and used in production for pharmaceutical
distribution in Zimbabwe, so a few things matter more here than in a typical
side project: correctness of money handling, statutory compliance logic, and
not breaking the ledger invariants.

## Before you start

For anything beyond a small fix, please open an issue first to discuss the
approach. This avoids wasted work on a pull request that doesn't fit the
project's direction.

## Development setup

```bash
git clone https://github.com/<org>/medledger-web.git
cd medledger-web
npm install
cp .env.example .env
# edit .env: DB_CLIENT=sqlite3 for local dev
npm run db:reset
npm start
```

Run the tests before opening a PR:

```bash
npm test
```

CI (`.github/workflows/ci.yml`) runs the same checks automatically on every
push and pull request — install, audit, migrate, seed, test suite, and a
production-mode boot check.

## Ground rules for this codebase

- **Money is never a float.** All amounts go through `src/lib/money.js` —
  integer cents for anything committed (documents, GL), integer
  ten-thousandths for unit prices/costs and quantities. If you're writing
  `Number` arithmetic on money directly, that's a bug, not a shortcut.
- **The ledger balances or it doesn't post.** Don't weaken the balance check
  in `src/modules/gl.service.js`. Corrections are reversal batches, not edits
  to posted batches.
- **Statutory figures need a citation.** Any PAYE band, NSSA rate, VAT rate,
  or similar figure should note its legislative source (see the
  `legislative_ref` columns and the `VERIFY` marker pattern in `seed.js`).
  Don't hardcode a number without saying where it came from.
- **New migrations, not edited ones.** Never modify a migration that has
  already been merged — add a new one. Migrations are portable between
  SQLite (dev/test) and SQL Server (prod); keep new schema changes in the
  Knex schema-builder subset that both dialects support.
- **Tests for anything touching money, GL posting, or access control.**
  `tests/money.test.js`, `tests/sales.test.js`, and `tests/auth.test.js` are
  the pattern to follow.

## Pull requests

1. Fork the repo and create a branch from `main`.
2. Make your change with tests.
3. Ensure `npm test` passes and `npm audit --audit-level=high` is clean.
4. Open a PR describing what changed and why. Link the issue if there is one.

## Code style

Plain, explicit code over cleverness — this is financial and regulatory
software that other people will need to audit. Comments should explain *why*,
not restate *what* the code does. Match the existing style in the module
you're editing rather than introducing a new pattern.

## Reporting bugs vs. reporting security issues

Regular bugs: open a GitHub issue.
Security vulnerabilities: see [SECURITY.md](./SECURITY.md) — please do not
file those as public issues.
