# Security Policy

## Reporting a vulnerability

If you discover a security vulnerability in MedLedger, please **do not** open
a public GitHub issue. Instead, report it privately:

- Email: **security@bushidokaizencorporation.com** *(update to a real, monitored address before publishing)*
- Include: a description of the issue, steps to reproduce, and the potential
  impact. A proof-of-concept is welcome but not required.

We aim to acknowledge reports within 5 business days and to resolve confirmed
critical issues within 30 days. Please give us a reasonable window to fix an
issue before any public disclosure.

## Supported versions

This project is under active development. Security fixes are applied to the
`main` branch. There is no long-term support branch yet — until a `1.0`
release, treat the latest commit on `main` as the only supported version.

## Scope

In scope:
- The application code in `src/` and `public/`
- The database migrations and seed data
- The Docker/deployment configuration in this repository

Out of scope:
- Third-party dependencies (report those upstream; `npm audit` runs in CI on
  every push)
- The ZIMRA FDMS and MCAZ/EPCIS *live* integrations, since this repository
  ships them in simulator mode only — no live regulator endpoint is called
  from this code as shipped

## Known, accepted risk in the default configuration

The seed script (`src/db/seed.js`) creates demo accounts with a shared,
publicly-documented password (`ChangeMe123!`). This is intentional for local
evaluation and is **not** a vulnerability report — it is documented in the
README. Anyone deploying this project for real use must rotate every seeded
credential and set a real `JWT_SECRET` before exposing it to a network. The
app refuses to boot in `NODE_ENV=production` with the default JWT secret, as
a backstop.
