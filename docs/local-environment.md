# Local Environment

Commons uses its own local Docker, database, and startup commands.

Do not share Docker containers, databases, migrations, environment files, or startup commands with Tribal Commons.

## Identity

- Project folder: `C:\Users\Nico\commons`
- Docker Compose file: `C:\Users\Nico\commons\docker-compose.yml`
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
