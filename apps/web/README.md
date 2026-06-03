# Commons — apps/web

Mutual aid coordination without unnecessary surveillance or hidden authority.

This is the Next.js web application for Commons. It implements the coordination model defined in the project RFCs: support requests, routing, responsibilities, accountability, communication spaces, and governance.

**Open Alpha status.** This software is experimental. See [docs/open-alpha.md](../../docs/open-alpha.md) before using it for anything real.

---

## Local Setup

**Prerequisites**

- Node.js 20+
- Docker (for PostgreSQL)

**Steps**

```powershell
# 1. From the repo root, start PostgreSQL
docker compose up -d

# 2. Move into the web app
cd apps/web

# 3. Create your environment file (see below)
# 4. Run migrations
npm run db:migrate

# 5. Seed demo data
npm run db:seed

# 6. Start the dev server
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000).

---

## Environment Variables

Create `apps/web/.env` with:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/commons_local_dev"
SESSION_SECRET="dev-commons-session-secret-change-this-in-production-32chars"
```

`DATABASE_URL` must point to the Commons PostgreSQL container on port `5433`. See [docs/local-environment.md](../../docs/local-environment.md) for Docker setup details.

`SESSION_SECRET` must be at least 32 characters. The value above is fine for local development only.

---

## Database Commands

```powershell
# Apply pending migrations
npm run db:migrate

# Seed demo data (Northside Commons group, sample accounts, requests)
npm run db:seed

# Open Prisma Studio (database browser)
npm run db:studio

# Regenerate Prisma client after schema changes
npm run db:generate
```

---

## Tests

```powershell
npm test
```

Tests use the real local database. Run `docker compose up -d` first.

The test runner uses `--test-concurrency=1` because tests share a live PostgreSQL database and use prefix-based fixture cleanup. Parallel file execution causes cleanup interference.

---

## Build

```powershell
npm run build
```

Produces a production Next.js build. All environment variables must be set.

---

## Alpha Operating Assumptions

- **No email system.** Account creation does not send a verification email. Password reset does not exist. If you lose your password in Alpha, create a new account.
- **Seed data.** `npm run db:seed` creates a demo group (Northside Commons) and sample accounts. The seed is idempotent and can be re-run after a data reset.
- **No production security.** Session secrets and database credentials in the example above are for local development only.
- **Alpha data may be reset.** The alpha database may be cleared at any time. Do not store anything you need to keep.

---

## Known Limitations

- No password reset or account recovery
- No email notifications
- No admin or moderation console
- Governance UX (petition UI, temperature signals) exists in the backend but is not yet surfaced in the dashboard
- No end-to-end encryption
- Federation not implemented
- No mobile/PWA support yet

See [docs/open-alpha.md](../../docs/open-alpha.md) for the full list of known gaps and what to test.

---

## Project Structure

```
apps/web/
  prisma/
    schema.prisma       — database schema
    migrations/         — migration history
    seed.ts             — demo data seed
  src/
    app/                — Next.js app router pages and server actions
    lib/                — service layer (petitions, governance, responsibilities, etc.)
    generated/          — Prisma client (do not edit)
```

Key lib files: `petitions.ts`, `governance-categories.ts`, `responsibilities.ts`, `participation.ts`, `concerns.ts`.

---

## Further Reading

- [docs/open-alpha.md](../../docs/open-alpha.md) — alpha scope, known gaps, demo scenarios, feedback guide
- [docs/local-environment.md](../../docs/local-environment.md) — Docker and database setup
- [docs/rfcs/](../../docs/rfcs/) — design rationale for core systems
