# Commons

Commons is a simple, secure mutual aid coordination app for real-world groups.

It is not a social network, charity management platform, surveillance system, automated governance engine, or generalized distributed governance framework. Commons is coordination infrastructure for communities that need to organize care, labor, resources, trust, projects, and decisions without surrendering autonomy to centralized authority.

The guiding standard is: make cooperation easier and domination harder.

The project charter is the main product compass: [docs/charter.md](docs/charter.md). UI work is governed by the [Commons Experience Principles](docs/experience-principles.md).

## Principles

- Store less data, especially about vulnerability.
- Prefer consent, dignity, reversibility, and local autonomy.
- Keep authority visible, temporary, scoped, and recallable.
- Make privacy envelopes and governance preferences first-class architecture.
- Avoid global reputation scores, hidden super-admin access, AI dependency, and permanent recipient records.
- Build one healthy local node before federation, plugins, or advanced syncing.
- Keep the core social loop in view: need appears, trusted people coordinate, help is delivered, contribution is remembered, vulnerability is not archived, and trust in the commons grows.

## Architecture Goals

- Browser-first responsive web app.
- Installable PWA path with offline drafts and encrypted local storage.
- PostgreSQL-backed node server through Prisma.
- Federation-ready data model: portable identities, linked node presence, signed events, migration paths.
- Plugin-ready boundaries with declared permissions and constitutional constraints.
- Human-understandable governance rather than automated rule by algorithm.

## MVP Build Order

1. Accounts, groups, projects, service capabilities, support requests, offers, contributions, proposals, roles, governance preferences, and privacy envelopes.
2. Core web workflows for dashboards, request intake, service directory, contribution logging, and proposals.
3. Request routing, contributor availability, trust petitions, and trust approvals.
4. PWA installation, offline drafts, encrypted local storage, and sync queue.
5. Governance and privacy resolution.
6. Security, audit logs, deletion workflows, and exports.
7. Federation readiness.
8. Plugin registration and permission enforcement.

## Local Setup

Prerequisites:

- Node.js
- pnpm 10 via Corepack
- PostgreSQL

Install dependencies:

```bash
corepack pnpm install
```

Prepare the database:

```sql
CREATE DATABASE commons;
```

Create `apps/web/.env`:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/commons"
```

Run migrations:

```bash
cd apps/web
corepack pnpm prisma migrate dev --name init
```

Start development:

```bash
corepack pnpm dev
```

Then visit `http://localhost:3000`.

## License

Commons is licensed under the GNU Affero General Public License v3.0. See [LICENSE](LICENSE).

