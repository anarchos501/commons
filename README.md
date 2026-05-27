# Commons

Commons is a simple, secure, decentralized mutual aid coordination app for real-world groups.

It is not a social network, charity management platform, surveillance system, or automated governance engine. Commons is a cooperation substrate for communities that need to coordinate support, projects, decisions, trusted services, and local infrastructure without surrendering autonomy to outside platforms.

The guiding standard is: make cooperation easier and domination harder.

## Principles

- Store less data, especially about vulnerability.
- Prefer consent, dignity, reversibility, and local autonomy.
- Keep authority visible, temporary, scoped, and recallable.
- Make privacy envelopes and governance preferences first-class architecture.
- Avoid global reputation scores, hidden super-admin access, AI dependency, and permanent recipient records.
- Build one healthy local node before federation, plugins, or advanced syncing.

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
DATABASE_URL="postgresql://postgres:password@localhost:5432/commons"
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
