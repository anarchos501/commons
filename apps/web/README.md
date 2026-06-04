# Commons - apps/web

Mutual aid coordination without unnecessary surveillance or hidden authority.

This is the Next.js web application for Commons. It implements the coordination model defined in the project RFCs: support requests, routing, responsibilities, accountability, communication spaces, project workspaces, and petition-backed governance.

**Open Alpha status.** This software is experimental. See [docs/open-alpha.md](../../docs/open-alpha.md) before using it for anything real.

---

## Local Setup

**Prerequisites**

- Node.js 20+
- pnpm 10 via Corepack
- Docker, for PostgreSQL

**Steps**

```powershell
# 1. From the repo root, start PostgreSQL
docker compose up -d

# 2. Create your environment file
Copy-Item apps/web/.env.example apps/web/.env

# 3. Run migrations
pnpm --dir apps/web db:migrate

# 4. Seed demo data
pnpm --dir apps/web db:seed

# 5. Start the dev server
pnpm --dir apps/web dev
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
pnpm --dir apps/web db:migrate
pnpm --dir apps/web db:seed
pnpm --dir apps/web db:studio
pnpm --dir apps/web db:generate
```

---

## Tests And Build

```powershell
pnpm test
pnpm --dir apps/web lint
pnpm --dir apps/web build
```

Tests use the real local database. Run `docker compose up -d` first.

The test runner uses `--test-concurrency=1` because tests share a live PostgreSQL database and use prefix-based fixture cleanup.

---

## Current UI Surface

- Public users can browse groups, request support, track request status, register, and apply for membership where sponsorship is required.
- Authenticated users get a dashboard plus group, project, and responsibility workspaces through the sidebar.
- Group workspaces expose discussion, library material, members, petitions, contribution categories, trusted providers, responsibilities, governance settings, emergency periods, and accountability concerns.
- Project workspaces expose their own discussion, library, members, petitions, and contribution categories. Project-internal petitions and participation use project membership.
- Responsibility workspaces expose role overview, holders, volunteer/resign controls, discussion, and library material.
- Governance UI is surfaced for all 12 categories with temperature signals, resolved thresholds, petition durations, support/withdraw actions, and explicit petition outcome checks.

---

## Alpha Operating Assumptions

- **No email system.** Account creation does not send verification email. Password reset does not exist.
- **Seed data.** `pnpm --dir apps/web db:seed` creates a demo group and sample accounts. The seed is idempotent.
- **No production security posture.** Session secrets and database credentials in examples are for local development only.
- **Alpha data may be reset.** Do not store anything you need to keep.

---

## Known Limitations

- No password reset or account recovery.
- No email notifications.
- No admin or moderation console.
- No end-to-end encryption.
- Federation is not implemented.
- Plugin runtime is not implemented.
- No mobile/PWA offline support yet.
- Responsibility type creation is not yet petition-backed; responsibility volunteering is petition-backed.
- Some advanced proposal families remain backend primitives without polished public workflows.

See [docs/open-alpha.md](../../docs/open-alpha.md) for the full list of known gaps and what to test.

---

## Project Structure

```text
apps/web/
  prisma/
    schema.prisma       - database schema
    migrations/         - migration history
    seed.ts             - demo data seed
  src/
    app/                - Next.js app router pages and server actions
    lib/                - service layer
    generated/          - Prisma client, do not edit manually
```

Key lib files: `petitions.ts`, `petition-evaluation.ts`, `governance-categories.ts`, `responsibilities.ts`, `project-membership.ts`, `participation.ts`, `concerns.ts`.

---

## Further Reading

- [docs/open-alpha.md](../../docs/open-alpha.md) - alpha scope, known gaps, demo scenarios, feedback guide
- [docs/local-environment.md](../../docs/local-environment.md) - Docker and database setup
- [docs/rfcs/](../../docs/rfcs/) - design rationale for core systems
