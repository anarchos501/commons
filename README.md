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

## Current Alpha

Commons currently includes:

- Account registration, login, collectives (groups), public support request intake, and request status links. The first person to register on a new node automatically founds the node.
- Collective workspaces with discussion, bulletins, publications, living documents, members, petitions, governance settings, contribution categories, trusted providers, responsibilities, and concerns.
- Project workspaces with their own discussion, library, members (with join requests), petitions, and contribution categories. Project-internal governance is scoped to active project members rather than host-collective membership.
- Responsibility workspaces for group-accountable roles, including holders, volunteering, resignation, discussion, and library material.
- Petition-backed governance flows for membership sponsorship, project proposals, project join requests, responsibility volunteering, living document revisions, archival decisions, emergency declarations, contribution categories, and trusted provider status.
- Coalitions: multi-collective federation spaces where each collective retains its own membership and governance. Coalition proposals (joining, departing, removal, host-adoption) run as bundled petitions requiring separate approval by each member collective.
- Governance temperature signals across 16 categories, with resolved thresholds and petition durations visible in the UI.
- Node feedback inbox for surfacing routing activity and coordination signals to node hosts.
- A public plain-language guide page explaining core concepts, governance, and how to get started.
- PostgreSQL persistence through Prisma, action logging, privacy envelope primitives, and federation/plugin-ready schema foundations.

**Terminology note:** The user-facing label for what the codebase calls a "Group" is "Collective." Code variable names (`groupId`, `GroupMembership`, etc.), URL paths (`/groups/...`), and database fields are unchanged.

Commons is still Open Alpha software. It does not yet provide password reset, email notifications, end-to-end encryption, production moderation/admin tooling, federation, plugins, or mobile/PWA offline support.

## Local Setup

Prerequisites:

- Node.js
- pnpm 10 via Corepack
- Docker Desktop

Install dependencies:

```bash
corepack pnpm install
```

Start the Commons PostgreSQL container:

```bash
docker compose up -d
```

This starts:

- Container: `commons-postgres`
- Database: `commons_local_dev`
- Host port: `5433`
- Volume: `commons-postgres-data`

If you manage PostgreSQL outside Docker, create the database yourself:

```sql
CREATE DATABASE commons_local_dev;
```

Create the local environment file:

```bash
cp apps/web/.env.example apps/web/.env
```

Update `apps/web/.env` if your PostgreSQL username, password, host, port, or database name differs:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/commons_local_dev"
```

See [docs/local-environment.md](docs/local-environment.md) for Docker and project separation checks.

Generate the Prisma client and apply migrations:

```bash
corepack pnpm db:generate
corepack pnpm db:migrate
```

Seeding is no longer required for basic use. The first account registered automatically creates the node. If you want a richer starting state for development, you can still run:

```bash
corepack pnpm db:seed
```

Verify the app and local-first domain logic:

```bash
corepack pnpm test
corepack pnpm build
```

Start development:

```bash
corepack pnpm dev
```

Then visit `http://localhost:3000`.

Useful database references:

```bash
corepack pnpm db:studio
cd apps/web
corepack pnpm prisma generate
corepack pnpm prisma migrate dev
corepack pnpm prisma db seed
```

## License

Commons is licensed under the GNU Affero General Public License v3.0. See [LICENSE](LICENSE).
