# ChemLink Platform — Backend

Build Sequence **Step 0** (DevOps foundation) through **Step 6** (Credit & Billing), as defined in the ChemLink Platform System Design Document, Section 16.2.

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

**Step 2 — Product Catalog & Documents**
- Prisma schema: `Category` (the 10 industry categories, as a table so Admin can edit them later without a migration), `Product`, `ProductSpec` (flexible key/value rows grouped by the four Enhanced TDS tabs from Section 5.3), `ProductDocument` (SDS/COA/TDS)
- `GET /api/v1/categories` — public
- `POST/PATCH/DELETE /api/v1/products` — seller-only, requires the company's SELLER role to be **VERIFIED**, not just activated (Section 14.3)
- `POST/DELETE /api/v1/products/:id/documents` — attach/remove SDS/COA/TDS
- `GET /api/v1/products/mine` — a seller's own catalog including unpublished drafts

**Step 3 — Search & Filter**
- `GET /api/v1/products` — public search: free text (name/CAS), category, province, max lead time, max MOQ, stock status, and **minimum Trust Score** (Section 5.2 facets), paginated
- Added `CompanyRole.compositeTrustScore`, a persisted field kept in sync via `computeCompositeTrustScore()` (`src/common/util/trust-score.ts`) implementing the exact 30/50/20 weighting from Section 15.1 — this lets search filter/sort by Trust Score without recomputing it per row
- Deliberately basic (`ILIKE`-style text match + structured filters), matching the MVP scope in Section 10 ("แคตตาล็อกสินค้า + การค้นหาพื้นฐาน") — AI-ranked matching is Step 11, not this slice

**Step 4 — RFQ / Deal Room** (this is what makes `rfq.html` and `deal-room.html` real)
- Prisma schema: `Rfq`, `Deal` (one per RFQ-seller pair — the unit `deal-room.html` renders), `Quote` (versioned, never edited in place — matches the "ฉบับที่ 1 / ฉบับที่ 2" quote-revision cards), `DealMessage` (thread entries: TEXT / QUOTE / SYSTEM)
- `POST/PATCH /api/v1/rfqs` — buyer creates/edits a draft (requires VERIFIED BUYER role), `POST /api/v1/rfqs/:id/submit` — choose `TARGETED` (explicit seller list) or `MARKET` (Section 6's rule-based matching: verified sellers with a published product in the same category/CAS — full AI matching is Step 11 per Section 10 scope)
- **Section 14.4 self-dealing guard is enforced at the query level, not just validated input**: a company's own ID is filtered out of `TARGETED` recipient lists and excluded from `MARKET` matching (`sellerCompanyId: { not: buyerCompanyId }`), so a dual-role company can never end up as both the buyer and seller on the same RFQ — see `rfq.service.spec.ts` for the tests proving this
- `GET /api/v1/deals/incoming` (seller inbox), `GET /api/v1/deals/:id` (the Deal Room view: full thread + all quote versions), `POST .../acknowledge`, `POST .../quotes` (new version + auto system message), `POST .../messages`, `POST .../close` (marks the chosen Deal WON, every sibling Deal on the same RFQ LOST, and the parent RFQ `CLOSED_WON` — Section 6 step 7), `POST .../decline`
- `DealsService.loadAndAuthorize()` checks every action against real participant identity (only the seller on *that* Deal can quote/acknowledge; only the buyer who owns the parent RFQ can close it) — not just "any authenticated seller"
- RFQ/Deal status machines follow the 8-state Section 6 workflow (`DRAFT → SUBMITTED → ACKNOWLEDGED → QUOTED → NEGOTIATING → VERIFICATION → CLOSED_WON/CLOSED_LOST → RATED`); `RATED` is reserved for Step 9 (ratings) to set

**Step 5 — Notifications** (this is what makes a seller actually *find out* an RFQ arrived, instead of only seeing it by polling `/deals/incoming`)
- Prisma schema: `Notification` (one unified inbox row per user, per event — Section 5.6/5.7's "Unified Notification Center": a single inbox that mixes buyer-side and seller-side events regardless of which role they happened under, Section 14.3)
- `NotificationsService.createForUser()` / `createForCompany()` always take a Prisma **transaction client** as their first argument and are called from *inside* the same `$transaction` as the RFQ/Deal state change they describe — an `RFQ_RECEIVED` notification can never exist for a Deal that failed to actually get created, and vice versa
- Email is a separate, best-effort delivery channel (`EmailChannel`) layered on top of the in-app row, dispatched *after* the transaction commits — an SMTP failure can never roll back an RFQ submission. With no `SMTP_HOST` configured, it just logs instead of sending, so the rest of the app works fully without real mail credentials
- Wired into every Step 4 event: RFQ submitted → all active users at each matched/targeted seller company; seller acknowledges/quotes → the RFQ's creator; a Deal Room message → whichever side didn't send it; deal closed → `DEAL_CLOSED_WON` to the winner's company, `DEAL_CLOSED_LOST` to every sibling seller
- `GET /api/v1/notifications` (paginated, `?unreadOnly=true` filter), `GET /api/v1/notifications/unread-count`, `POST /api/v1/notifications/:id/read`, `POST /api/v1/notifications/read-all`

**Step 6 — Credit & Billing** (Section 13; this is what makes sending an RFQ actually cost something)
- Prisma schema: `SubscriptionPlan` (Basic/Pro/Enterprise, each with a monthly free-credit quota — Section 13.4 "Subscription + Credit แบบผสม"), `CreditWallet` (**one per Company, not per role** — Section 14.5 — auto-created on BASIC the first time a company is charged), `CreditTransaction` (immutable ledger — app code only ever `create`s a row, never updates/deletes one), `CreditRateCard` (admin-editable, versioned by `effectiveFrom` so a past charge always reflects the rate it was actually charged at), `CreditPackage` (top-up catalog — see deferred items below)
- `CreditsService.chargeForAction(tx, companyId, actionType, roleContext, related?)` is the one metering entry point, and — following the same pattern as `NotificationsService` in Step 5 — must be called with the caller's own transaction client, so a charge can never succeed for an action that then fails to happen. **Reference integration: `RfqService.submit()`** charges `SEND_RFQ` once per submission, before any `Deal` rows are written, so an unpayable RFQ leaves no partial state (see `rfq.service.spec.ts`, "submit — Section 13 credit charge")
- Section 13.1's three-tier policy — free / free-quota-then-wallet / always-charged — is enforced in `chargeForAction`: quota-eligible actions (`SEND_RFQ`, `DOWNLOAD_TECH_DOCUMENT`, `AI_SOURCING_QUERY`, `DEAL_ROOM_ACCESS`) draw from `CreditWallet.monthlyFreeQuota` first and only debit the paid balance once that's exhausted; always-charged actions (`EXPORT_PRICE_INDEX`, `UNLOCK_CONTACT`, `MARKET_INTELLIGENCE_REPORT`, `UNLOCK_LEAD`) skip the quota entirely, matching the three rows of Section 13.1's table
- **Atomicity (Section 13.2 "Atomic Transaction... Race Condition") is a conditional `UPDATE ... WHERE balance >= cost`, not a read-then-write balance check** — two concurrent charges racing against a balance that can only cover one of them can never both succeed. No Redis is involved; see the `REDIS_URL` note in `.env.example` — that's reserved for Step 7+ performance caching, not correctness
- Only `SEND_RFQ` is wired into an actual endpoint so far. The rest of `CreditActionType` exists in the schema and rate card ahead of the features that will charge for them (document downloads, the Sourcing Assistant, Deal Room access, price-index export, contact/lead unlock) — same "define the enum ahead of the feature" approach the RFQ `VERIFICATION` status already uses
- `GET /api/v1/credits/wallet` (balance + plan + quota status), `GET /api/v1/credits/wallet/transactions` (paginated ledger, optional `?roleContext=BUYER|SELLER` filter — Section 14.5's "usage broken down by role"), `GET /api/v1/credits/rate-card` (current per-action cost, for the frontend's Section 13.1 price-transparency confirm dialog)

## Not in this scaffold yet

Step 7 onward (ratings, admin panel, AI matching/Sourcing Assistant, Redis-backed metering cache). LINE and push notifications are not implemented — `EmailChannel` is the only delivery channel wired up; the code is structured so a `LineChannel`/`PushChannel` can be added the same way once a provider is chosen, without touching `NotificationsService`'s callers. The `VERIFICATION` RFQ status (Section 6 step 6, third-party quality checks for high-value deals) exists in the enum but nothing transitions into it yet — that depends on the external inspection service integration described in Section 8.

**Deferred from Step 6's Billing & Metering Layer (Section 13.2)** — these depend on decisions/integrations outside this repo, not on more engineering time:
- **Payment Gateway Integration** and **Top-up & Package Store checkout** — `CreditPackage` exists as a catalog table, but actually buying one needs a real payment provider (PromptPay/card processor) to be chosen first; there's no self-serve "buy credits" endpoint yet
- **Tax Invoice Generator** — no `Invoice` model/PDF generation yet; needs the payment integration above first, since an invoice is generated per purchase
- **Admin Credit Console** (Section 13.2's "ให้ Category Manager ปรับหรือแจกเครดิตพิเศษได้") — `CreditsService.grantCredits()` exists and is unit-tested, but isn't wired to an HTTP endpoint: that needs a platform-admin auth concept, and Section 8's Admin Panel is separately unbuilt. The seed script calls it directly to fund the two seed companies
- **Low-balance Alert & Auto Top-up**, **Abuse/Fraud Detection** — not started
- Frontend price-transparency confirm dialog (Section 13.1's "การดาวน์โหลดเอกสารนี้ใช้ 5 เครดิต... ยืนยันหรือไม่") — the backend supports it (`GET /credits/rate-card`, and `chargeForAction` fails cleanly with HTTP 402 on insufficient balance instead of ever charging silently) but none of the seven static HTML pages call it yet

## A note on verification in this environment

This was built and type-checked in a sandbox that can't reach `binaries.prisma.sh`, so `prisma generate` can't complete here. Two consequences, both purely environmental:

1. A live `tsc` run shows cascading "Module has no exported member" errors, all traceable to that one blocked host. A temporary hand-written type stub matching the schema was used to isolate genuine errors from generation-cascade noise; with the stub in place, **all Step 1-5 code type-checks with zero errors**. The stub was deleted before packaging.
2. Unit tests that reference a Prisma enum by name (`rfq.service.spec.ts`, `deals.service.spec.ts`, 3 of 7 cases in `notifications.service.spec.ts`) can't execute here either — Jest imports the real (ungenerated) `@prisma/client` package at runtime, and its enums are `undefined` until generated. Tests that don't touch an enum value directly (e.g. `dispatchEmails`, `markRead` ownership checks) do run and pass in this sandbox today. Run `npx prisma generate` first and the rest will run normally, including the Section 14.4 self-dealing proofs.

Run `npx prisma generate` before your first build or test run; this works fine outside this sandbox (local machine or the GitHub Actions CI already included).

**Step 6 addendum:** the same environment blocked `prisma generate` again, so this time the stub was extended one step further — real placeholder enum *values* (not just types) and a minimal `PrismaClientKnownRequestError`, patched directly into the installed `@prisma/client` package rather than left as source. That let `npx tsc --noEmit`, `npm run build`, `npm run lint`, and `npx jest` all actually **run** against Step 6 (not just type-check): clean build, clean lint (the 2 pre-existing errors in `email.channel.ts` and `submit-rfq.dto.ts` are unrelated to this step and were already there), and **50/50 tests pass**, including all `credits.service.spec.ts` cases (the quota-vs-wallet split, the atomic-debit race guard, insufficient-credit rejection) and the new `RfqService.submit()` integration tests. Getting the suite to actually execute also surfaced and fixed a latent bug in 3 pre-existing `rfq.service.spec.ts` cases (`deal.create` had no mocked return value, so `deal.id` would throw) that no one — human or AI — had been able to actually run before now. None of this patching touched anything under `src/` or `prisma/`; it lived entirely in `node_modules`, so it doesn't affect what you're pulling. **Still needed before this is trustworthy**: run `npx prisma generate` for real, then `npm test` again, on a machine (or CI) that can reach `binaries.prisma.sh` — the patch is a stand-in for the type/enum *shapes*, not a substitute for the real query engine.

**Also new in Step 6 — this repo has never had a Prisma migration.** `prisma/migrations/` doesn't exist and never has (checked the full git history); Steps 1-5 shipped by editing `schema.prisma` directly, and the CI/Render `npx prisma migrate deploy` step has been a silent no-op this whole time (nothing to apply). The actual schema currently live on Render was almost certainly pushed with `prisma db push` outside of git at some point. This isn't something Step 6 needs to fix on its own, but it means: running `npx prisma migrate dev --name step6_credit_billing` for the first time won't create a small Step-6-only migration — it'll generate one large *baseline* migration covering the entire schema to date, because there's no earlier migration for it to diff against. That's expected, not a bug. Alternatively, keep using `prisma db push` for now (matches how this repo has actually been evolving) and revisit switching to real Migrate history as its own task.

## Getting started

```bash
cp .env.example .env
docker compose up --build
```

This starts Postgres, Redis, and the API, runs pending Prisma migrations, and serves the API on `http://localhost:3000/api/v1`.

To seed the 10 categories, two example companies, and one sample product (matches the `product.html` mockup):

```bash
docker compose exec api npm run prisma:seed
```

### Running without Docker

```bash
npm install
npx prisma generate
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

# Browse categories (after seeding)
curl http://localhost:3000/api/v1/categories

# Search products with filters (Section 5.2)
curl "http://localhost:3000/api/v1/products?q=PP&maxLeadTimeDays=10&minTrustScore=4"

# Get one product with its specs and documents
curl http://localhost:3000/api/v1/products/<productId>

# --- RFQ / Deal Room (Step 4) — use the access token from /auth/login ---

# Create a draft RFQ
curl -X POST http://localhost:3000/api/v1/rfqs \
  -H "Content-Type: application/json" -H "Authorization: Bearer <token>" \
  -d '{
    "categoryId": "<categoryId>",
    "productName": "PP รีไซเคิล เกรด Injection",
    "casNumber": "9003-07-0",
    "quantityValue": 12000,
    "quantityUnit": "กก.",
    "deliveryLocation": "นิคมอุตสาหกรรมบางปู, สมุทรปราการ",
    "deliveryDeadline": "2026-08-15"
  }'

# Submit it into RFQ Market (rule-based matching, Section 6)
curl -X POST http://localhost:3000/api/v1/rfqs/<rfqId>/submit \
  -H "Content-Type: application/json" -H "Authorization: Bearer <token>" \
  -d '{"distributionType": "MARKET"}'

# Seller checks their inbox, then quotes on a Deal
curl http://localhost:3000/api/v1/deals/incoming -H "Authorization: Bearer <sellerToken>"
curl -X POST http://localhost:3000/api/v1/deals/<dealId>/quotes \
  -H "Content-Type: application/json" -H "Authorization: Bearer <sellerToken>" \
  -d '{"price": 36.8, "priceUnit": "บาท/กก.", "paymentTerms": "เครดิต 30 วัน", "leadTimeDays": 7}'

# Buyer closes the deal
curl -X POST http://localhost:3000/api/v1/deals/<dealId>/close -H "Authorization: Bearer <token>"

# --- Notifications (Step 5) ---

# Check your unread count
curl http://localhost:3000/api/v1/notifications/unread-count -H "Authorization: Bearer <token>"

# List notifications (unread only)
curl "http://localhost:3000/api/v1/notifications?unreadOnly=true" -H "Authorization: Bearer <token>"

# Mark one as read
curl -X POST http://localhost:3000/api/v1/notifications/<notificationId>/read -H "Authorization: Bearer <token>"

# --- Credit & Billing (Step 6) ---

# Current wallet balance, plan, and monthly free-quota status
curl http://localhost:3000/api/v1/credits/wallet -H "Authorization: Bearer <token>"

# Ledger, newest first — add ?roleContext=BUYER or SELLER to split dual-role usage
curl http://localhost:3000/api/v1/credits/wallet/transactions -H "Authorization: Bearer <token>"

# What each metered action currently costs (for a price-transparency confirm dialog)
curl http://localhost:3000/api/v1/credits/rate-card -H "Authorization: Bearer <token>"

# Submitting an RFQ (Step 4) now charges SEND_RFQ from the same call —
# no separate "charge" endpoint to call first
curl -X POST http://localhost:3000/api/v1/rfqs/<rfqId>/submit \
  -H "Content-Type: application/json" -H "Authorization: Bearer <token>" \
  -d '{"distributionType": "MARKET"}'
```

## Project layout

```
src/
  common/          guards, decorators, filters, interceptors, trust-score util
  config/          typed environment configuration (includes SMTP)
  prisma/          PrismaService + module (global DB access)
  modules/
    auth/          register / login / refresh / logout / me
    companies/     company profile + role activation
    users/         teammate invitation scoped to company roles
    categories/     read-only category listing
    products/       catalog CRUD, documents, search & filter
    rfq/            buyer-side RFQ draft/submit/cancel (Step 4)
    deals/          seller inbox + Deal Room actions: acknowledge, quote, message, close (Step 4)
    notifications/  unified notification inbox + email channel (Step 5)
    credits/        wallet, ledger, rate card, atomic metering (Step 6)
    health/        liveness/readiness probe
prisma/
  schema.prisma    Company / CompanyRole / VerificationDocument / User / RefreshToken /
                   Category / Product / ProductSpec / ProductDocument /
                   Rfq / Deal / Quote / DealMessage / Notification /
                   SubscriptionPlan / CreditWallet / CreditTransaction / CreditRateCard / CreditPackage
  seed.ts          10 categories + sample dual-role/buyer-only companies + 1 sample product +
                   3 subscription plans + starter rate card + 100-credit sign-up bonus per seed company
```

