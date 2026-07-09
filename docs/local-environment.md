# Local Environment

Commons uses its own local Docker, database, and startup commands.

Do not share Docker containers, databases, migrations, environment files, or startup commands with Tribal Commons.

## Identity

- PostgreSQL container: `commons-postgres`
- PostgreSQL database: `commons_local_dev`
- PostgreSQL host port: `5433`
- PostgreSQL volume: `commons-postgres-data`

## Commands

Start PostgreSQL from the Commons repo root:

```powershell
docker compose up -d
```

Verify the database:

```powershell
docker exec commons-postgres psql -U postgres -d commons_local_dev -c "SELECT current_database();"
```

Check local Docker separation:

```powershell
docker ps -a --format "{{.Names}} {{.Status}}"
docker volume ls
```

## Two-node federation harness

Federation development needs two Commons instances talking to each other. They must use **distinct hostnames**, not just distinct ports: host normalization strips ports, so two instances on plain `localhost` would resolve to the same node identity. The harness uses the RFC 6761 `*.localhost` names, which resolve to loopback:

- Node A: `http://node-a.localhost:3000`, database from `.env`
- Node B: `http://node-b.localhost:3001`, database from `.env.node-b`

Setup (all from `apps/web`):

```bash
cp .env.node-b.example .env.node-b   # then adjust DATABASE_URL host/credentials to match your .env
pnpm db:setup:node-b                 # creates the commons_node_b database on the same server
pnpm db:migrate:node-b               # applies migrations to it
pnpm dev:node-a                      # first instance on :3000
pnpm dev:node-b                      # second instance on :3001 (separate terminal)
```

Add both names to your hosts file — this is effectively required, not optional: browsers and curl
resolve `*.localhost` themselves, but Node's own DNS lookup (which federation delivery between the
two instances uses) does not, so without these entries cross-node delivery fails with `ENOTFOUND`
even while the pages load fine. Devcontainers reset `/etc/hosts` on rebuild; re-add after rebuilds.

```
127.0.0.1 node-a.localhost node-b.localhost
```

Register each node's first account **through its own hostname** (`http://node-a.localhost:3000/register`, `http://node-b.localhost:3001/register`) — Commons records the first-registration hostname as the node's permanent domain, and federation identifies peers by that domain. Registering via `localhost:3000` would mint the wrong identity.

Cross-node deliveries flow through the federation outbox (a 30-second sweep); watch each instance's console for `[federation]` lines. `/.well-known/commons` on each instance shows what a peer sees when pinning it.

## Continuity restart blip

With an active backup designation (F3.5), restarting a dev node makes its backed-up
collectives read-only for a few seconds after boot: `markUnverifiedAtBoot` runs first in
`instrumentation.ts`, and writes resume only after the signed `continuity-status` pull to the
backup node round-trips. Expected, fail-safe behavior — not a bug. Stopping node B while node
A has a backup there keeps A's backed-up groups read-only until B returns (or until the
federation contact clock W lapses and the ordinary lease rules take over).
