# ChemLink Platform — Backend

Build Sequence **Step 0** (DevOps foundation) and **Step 1** (Identity & Company/User module), as defined in the ChemLink Platform System Design Document, Section 16.2.

## What's in this scaffold

**Step 0 — DevOps foundation**
- `docker-compose.yml` — Postgres + Redis + API for local dev, one command up
- `Dockerfile` — multi-stage (development / build / production)
- `.github/workflows/ci.yml` — lint, Prisma migrate, build, test on every push/PR
- `.github/workflows/docker-publish.yml` — builds and pushes the production image to GHCR on `main`
- `/api/v1/health` — liveness/readiness probe (checks DB connectivity)
- `.env.example` — every environment variable the app reads

**Step 1 — Identity & Company/User module**
- Prisma schema: `Company`, `CompanyRole`, `VerificationDocument`, `User`, `RefreshToken` (Section 7 / 14.2)
- `POST /api/v1/auth/register` — registers a Company, activates one or more roles (BUYER and/or SELLER) in a single multi-select step, and creates the first admin user (Section 14.1 — no forced single-role signup)
- `POST /api/v1/auth/login`, `/refresh`, `/logout`, `GET /me` — JWT access + rotating refresh tokens
- `POST /api/v1/companies/:id/roles` — activate a second role on an existing company later, without re-registering (progressive onboarding, Section 14.1)
- `POST /api/v1/users/invite` — a company admin adds a teammate scoped to a subset of the company's activated roles (Section 14.1 — a sales rep doesn't automatically get buyer access)
- `RolesGuard` — every role-restricted endpoint is checked at two levels: does *this user* have the role, and has *the company* actually activated it (Section 14.1 / 14.3)

## Not in this scaffold yet

Everything from Build Sequence Step 2 onward (product catalog, search, RFQ, credits, ratings) — those are separate follow-up steps. `SellerVerification`/`BuyerVerification` document review is modeled (`VerificationDocument`) but the upload/review endpoints are intentionally left out of Step 1 to keep this slice focused on auth + identity.

## Getting started

```bash
cp .env.example .env
docker compose up --build
```

This starts Postgres, Redis, and the API, runs pending Prisma migrations, and serves the API on `http://localhost:3000/api/v1`.

To seed two example companies (one dual-role, one buyer-only — mirrors Section 14 scenarios):

```bash
docker compose exec api npm run prisma:seed
```

### Running without Docker

```bash
npm install
npx prisma migrate dev
npm run start:dev
```

Requires a local Postgres reachable at the `DATABASE_URL` in `.env`.

## Try it

```bash
# Register a dual-role company (buyer + seller) with its first admin user
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "companyLegalName": "บจก. ทดสอบเคมีคอล",
    "companyTaxId": "0105500009999",
    "roles": ["BUYER", "SELLER"],
    "email": "owner@testchemical.example",
    "password": "Passw0rd!",
    "fullName": "ทดสอบ ระบบ"
  }'

# Log in
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "owner@testchemical.example", "password": "Passw0rd!"}'
```

## Project layout

```
src/
  common/          guards, decorators, filters, interceptors shared across modules
  config/          typed environment configuration
  prisma/          PrismaService + module (global DB access)
  modules/
    auth/          register / login / refresh / logout / me
    companies/     company profile + role activation
    users/         teammate invitation scoped to company roles
    health/        liveness/readiness probe
prisma/
  schema.prisma    Company / CompanyRole / VerificationDocument / User / RefreshToken
  seed.ts          sample dual-role + buyer-only companies
```
