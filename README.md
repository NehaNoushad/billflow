# BILLFLOW

**Subscription management and recurring billing for B2B SaaS businesses.** Products and variants, subscription plans, customers, quotations, a full subscription lifecycle, an automated recurring billing engine, GST-ready taxes, discounts, partial payments, financial analytics, and an **AI Revenue Guard** that finds revenue leakage in your real data.

Built for the Brightloop Software hackathon.

---

## Tech stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router, Server Components, Server Actions, Route Handlers) |
| Language | TypeScript |
| UI | Tailwind CSS v4, shadcn/ui (Base UI), Lucide icons, Sonner toasts |
| Data | MongoDB + Mongoose 9 |
| Auth | Custom: bcrypt password hashing, signed HTTP-only JWT session cookie (jose), role-based permissions checked on the server |
| Forms | React Hook Form + Zod (the same schemas validate again on the server) |
| Charts | Recharts |
| PDFs | jsPDF + jspdf-autotable, generated on the server |
| AI | Gemini or OpenAI (optional). Without a key, rule-based summaries are used |

---

## Quick start (local)

**You need:** Node.js 20.9+ and either Docker (for a local MongoDB) or a free MongoDB Atlas cluster.

```bash
# 1. Install dependencies
npm install

# 2. Start MongoDB locally with Docker (skip if you use Atlas)
docker run -d --name billflow-mongo -p 27017:27017 -v billflow-mongo:/data/db mongo:7

# 3. Configure environment variables
cp .env.example .env.local
#    then set AUTH_SECRET (and CRON_SECRET) to long random strings:
#    openssl rand -base64 48

# 4. Load demo data
npm run seed

# 5. Run the app
npm run dev
```

Open http://localhost:3000.

### Demo accounts

All demo accounts use the password **`Demo@12345`**.

| Role | Email | What they see |
| --- | --- | --- |
| Admin | `admin@billflow.demo` | Everything, including catalogue management, billing runs, staff and settings |
| Staff | `staff@billflow.demo` | Operations for **their assigned customers only**. No admin settings |
| Staff 2 | `staff2@billflow.demo` | A different set of assigned customers |
| Customer | `customer@billflow.demo` | Self-service portal for Lumen Labs Pvt Ltd |

The login page has one-click buttons that fill these in.

### Resetting the demo

* From the app: **Settings → Demo mode → Reset demo data** (admin only, requires `DEMO_MODE=true`).
* From the terminal: `npm run seed`.

---

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `MONGODB_URI` | ✅ | MongoDB connection string |
| `AUTH_SECRET` | ✅ | ≥ 32 random characters, used to sign session cookies |
| `APP_URL` | ✅ | Public URL, used in password reset links |
| `CRON_SECRET` | ✅ for cron | Protects `/api/cron/billing` (sent as `Authorization: Bearer …`) |
| `DEMO_MODE` | optional | `true` enables the in-app demo reset |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | optional | AI Revenue Guard summaries via Gemini (default model `gemini-2.5-flash`) |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | optional | Alternative AI provider (default `gpt-4o-mini`) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | optional | Sends password reset and invoice emails. Without SMTP, email buttons are disabled and, **in development only**, the reset link is shown on screen |

---

## Suggested 5-minute demo

1. **Catalogue**: as Admin, open **Products → New**, add a product with variants (watch the price update per variant). Then **Plans → New**, attach the product and check the live pricing preview.
2. **Quotation**: **Quotations → New** (or start from a template). Pick the customer, plan and lines; discounts and GST are calculated automatically. **Send**, then **Accept**.
3. **Subscription**: click **Convert to subscription**, then **Activate** it on the subscription page.
4. **Recurring billing**: **Billing Runs → Run billing now**. The summary shows subscriptions processed, invoices generated, skipped and failed, and total value. Run it again: zero duplicates.
5. **Invoice**: open the generated invoice. Download the PDF or print it.
6. **Payment**: **Record payment**. Try a partial payment first. The invoice only becomes *Paid* when the balance reaches zero.
7. **Analytics**: the **Dashboard** now shows the new invoiced and collected revenue, MRR and charts.
8. **Revenue Guard**: **Run scan**. It flags real issues planted in the demo data: an active subscription that was never billed, a manually duplicated invoice, a subscription priced below cost, overdue invoices, late-paying customers, and expiring subscriptions and discounts. Each finding links to the records behind it.

**Tip:** for the most dramatic demo, run a Revenue Guard scan *before* step 4. It flags an active subscription that was never billed (critical). After the billing run catches it up, scan again and that finding is gone. Reset with `npm run seed` between rehearsals.

Bonus: sign in as the **customer** to see the portal, download invoices, request a pause, or make a *simulated* payment.

---

## How the important parts work

### Money is never a floating-point number
All amounts are stored as **integer paise** (₹1 = 100 paise) and all percentages as **basis points** (18% = 1800). Rounding is half-away-from-zero, applied once per tax per line. Discounts are spread across lines using the largest-remainder method, so the parts always add up exactly. See `src/lib/money.ts` and `src/lib/billing/calc.ts`.

### Historical prices never change
Quotations, subscriptions and invoices store an immutable **snapshot** of each line: product name, variant, unit price, cost, and tax names and rates. Editing a product later does not change what a customer was quoted or billed.

### Recurring billing engine (`src/services/billing.ts`)
1. Finds `ACTIVE` subscriptions whose `nextBillingDate` ≤ the run date.
2. For each unbilled period (catching up on missed ones, up to a safety cap), it builds the invoice from the subscription's snapshot, applies eligible discounts (dates, minimums, usage limits), calculates taxes and saves the invoice and its `InvoiceLine` documents.
3. **Duplicate-proof**: every engine invoice has an idempotency key `sub:<id>:<periodStart>` protected by a **unique index**. A second run, even at the same moment, gets a duplicate-key error and the period is recorded as *skipped*.
4. Advances `nextBillingDate` with a conditional update (optimistic concurrency).
5. If something fails, the half-written invoice is rolled back, discount usage is released, and the subscription's billing date is left alone so the next run retries.
6. Auto-closes subscriptions whose term has ended (when the plan's auto-close is on).
7. Every run is logged as a `BillingExecution` with per-subscription outcomes.

It runs daily via Vercel Cron (`vercel.json` → `/api/cron/billing`) and on demand from **Billing Runs**. The on-demand run accepts an "as of" date, so you can show future billing in a demo.

### Subscription lifecycle
`DRAFT → QUOTATION → CONFIRMED → ACTIVE → CLOSED`, plus `ACTIVE ⇄ PAUSED`. Transitions are checked against an allow-list and the plan's rules (allow pause, early close, renewal). They use a conditional update, so two people can't make conflicting changes at the same time.
**Pause rule:** paused periods are **not billed**. On resume, the next billing date and expiry move forward by the number of paused days. An admin can change this in Settings ("Charge during pause").

### Payments
Payments update the invoice with a single atomic, conditional MongoDB update. An invoice can never be overpaid, even by simultaneous requests. Partial payments are supported (configurable). Overdue status is calculated from the due date, never stored. Payments are **recorded or simulated**: no real payment gateway is connected, and simulated payments are labelled as such.

### Security
* Passwords are hashed with bcrypt (cost 12). Reset tokens are random, stored only as SHA-256 hashes, single-use and expire after 30 minutes.
* Sessions are signed, HTTP-only, `SameSite=Lax` cookies. Each request re-checks the user in the database, so deactivated users and password resets revoke sessions immediately.
* `src/proxy.ts` does fast redirects, but **every page, server action and API route checks permissions again on the server** (`src/lib/auth/permissions.ts`).
* **Data scoping**: staff only see customers assigned to them (and those customers' subscriptions, invoices and payments). Customers only see their own records. This applies to queries, record access, PDFs and CSV exports.
* Rate limiting (MongoDB-backed, works across serverless instances) on login, registration, password reset and forgot-password.

### AI Revenue Guard
Deterministic server-side checks find the problems. The AI is only asked to *explain* those findings and suggest next steps, and it receives only the computed facts. If no AI key is set, or the AI call fails, a rule-based summary is produced instead. Every finding links to the records that support it.

---

## Project structure

```
src/
  app/
    (auth)/          login, register, forgot-password, reset-password
    (app)/           admin & staff pages (dashboard, products, plans, customers, quotations,
                     subscriptions, invoices, payments, billing, taxes, discounts, reports,
                     revenue-guard, staff, settings)
    portal/          customer self-service portal
    api/             PDFs, CSV export, cron
  actions/           server actions (mutations), one file per module
  services/          business logic: billing engine, invoices, payments, subscriptions,
                     pricing, analytics, revenue guard, AI, seed
  models/            Mongoose models & indexes
  validators/        Zod schemas shared by forms and server
  lib/               money, dates, auth, db, email, rate limiting, pdf
  components/        UI kit (shadcn) and app components
tests/               unit + integration tests (node:test)
```

---

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run build` / `npm start` | Production build / serve |
| `npm run seed` | Wipe and load demo data |
| `npm test` | Unit tests (money, tax, discounts, dates) and integration tests (billing idempotency, concurrent payments, lifecycle). Uses a separate `billflow_test` database |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |

---

## Deploying to Vercel

1. Create a free **MongoDB Atlas** cluster. Add a database user and allow access from anywhere (`0.0.0.0/0`), since Vercel IPs are dynamic. Copy the connection string, ending in `/billflow`.
2. Push this repository to GitHub and import it in Vercel.
3. In **Project → Settings → Environment Variables**, add `MONGODB_URI`, `AUTH_SECRET`, `APP_URL` (your Vercel URL), `CRON_SECRET`, `DEMO_MODE=true`, plus any optional AI/SMTP keys.
4. Deploy. Then load demo data once from your machine:
   `MONGODB_URI="<atlas uri>" npx tsx src/scripts/seed.ts`
5. Vercel picks up the daily cron in `vercel.json` automatically and sends `CRON_SECRET` as a Bearer token.

---

## Known limitations

* No real payment gateway: payments are recorded manually or simulated.
* Emails need SMTP credentials.
* Multi-document operations use compensating rollbacks instead of MongoDB transactions, so a standalone MongoDB (like the Docker one) works. On a replica set or Atlas, these could be upgraded to transactions.
* Single currency (INR) and a single business timezone (Asia/Kolkata).
