# Deploying Commons on a VPS

This guide walks through deploying Commons on a fresh Ubuntu 24.04 VPS using Docker Compose and Caddy for automatic HTTPS. Each section is a paste-able block. Complete every step in order.

**Before you start:**
- DNS: point your domain's `@` and `www` A records to the VPS IP. Caddy won't issue a certificate until DNS resolves. Allow up to 24 hours.
- Do **not** register the first Commons account until HTTPS is working on your final domain. Commons records the hostname of the first registration request as the permanent node domain.

---

## 1. Connect to the VPS

Use Hostinger's browser terminal or PowerShell:

```
ssh root@YOUR_VPS_IP
```

---

## 2. Initial server setup

Install security updates and required packages:

```bash
apt update && apt upgrade -y
apt install -y git curl ufw
```

Configure the firewall (replace `YOUR_IP` with your actual IP, or omit the SSH restriction if you don't have a static IP):

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp          # SSH — restrict to your IP if possible
ufw allow 80/tcp          # HTTP (Caddy redirects to HTTPS)
ufw allow 443/tcp         # HTTPS
ufw allow 443/udp         # HTTPS/3 (HTTP3)
ufw enable
```

---

## 3. Install Docker Engine

```bash
curl -fsSL https://get.docker.com | sh
```

Verify:

```bash
docker --version
docker compose version
```

Both must be present. Docker Compose is included with Docker Engine as `docker compose` (not the old `docker-compose`).

---

## 4. Create a deployment user

Running as root is risky. Create a dedicated user:

```bash
adduser deploy
usermod -aG docker deploy
su - deploy
```

All remaining steps run as `deploy`.

---

## 5. Add swap (recommended for 4 GB VPS)

Builds can be memory-intensive. A 2 GB swap file provides breathing room:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## 6. Clone the repository

```bash
sudo mkdir -p /opt/commons
sudo chown deploy:deploy /opt/commons
git clone https://github.com/anarchos501/commons.git /opt/commons
cd /opt/commons
```

---

## 7. Configure the environment

```bash
cp apps/web/.env.production.example apps/web/.env.production
nano apps/web/.env.production
```

Fill in every value:

| Variable | How to generate |
|---|---|
| `POSTGRES_PASSWORD` | `openssl rand -hex 32` |
| `SESSION_SECRET` | `openssl rand -base64 48` |
| `FEEDBACK_FINGERPRINT_SECRET` | `openssl rand -base64 48` (different from `SESSION_SECRET`) |
| `COMMONS_APP_VERSION` | Leave as `0.1.0` |
| `GITHUB_FEEDBACK_*` | Leave blank unless you have a GitHub token |

`deploy.sh` stops before building if a required value is blank or still set to
`CHANGE_ME`.

---

## 8. Configure the domain

Edit the `Caddyfile` at the repository root:

```bash
nano Caddyfile
```

Replace both occurrences of `your-domain.example` with your actual domain (e.g. `commons.example.org`). Replace `you@example.com` with your email address.

---

## 9. First deploy

```bash
chmod +x deploy.sh
./deploy.sh
```

This will:
1. Build the Docker image (takes 3–8 minutes on first run)
2. Start PostgreSQL and wait for it to be ready
3. Run all Prisma migrations
4. Start the web server and Caddy

When complete, all three containers should show as running:

```bash
docker compose -f docker-compose.prod.yml --env-file apps/web/.env.production ps
```

---

## 10. Verify HTTPS and www redirect

```bash
curl -I http://your-domain.example
# Should return: 301 → https://your-domain.example

curl -I http://www.your-domain.example
# Should return: 301 → https://your-domain.example

curl -I https://your-domain.example
# Should return: 200
```

If the certificate isn't issued yet, wait a minute and try again. Caddy issues certificates automatically on first request.

---

## 11. Register the first account

Open a browser and visit `https://your-domain.example/register` — using the **real domain over HTTPS**. Do not use the IP address or localhost.

Create your account. Then create the first collective. The account that creates the first collective becomes the node host.

---

## 12. Enable VPS backups

In Hostinger's panel, enable automatic weekly backups for the VPS. After your first successful deploy, take a manual snapshot so you have a known-good restore point.

---

## Updating Commons

For every future update:

```bash
cd /opt/commons
./deploy.sh
```

The script pulls the latest code, builds a new image, runs any new migrations, and restarts the containers. If the migration step fails, the old containers remain running and the deploy is aborted.

**Before a significant update**, take a database backup first:

```bash
docker compose -f docker-compose.prod.yml --env-file apps/web/.env.production \
  exec postgres pg_dump -U commons commons_prod > backup-$(date +%Y%m%d-%H%M%S).sql
```

Store the dump somewhere off the VPS (your local machine, or an S3-compatible bucket).

---

## Database backup and restore

**Create a backup:**

```bash
cd /opt/commons
docker compose -f docker-compose.prod.yml --env-file apps/web/.env.production \
  exec postgres pg_dump -U commons commons_prod \
  > /opt/backups/commons-$(date +%Y%m%d-%H%M%S).sql
```

**Restore from a backup:**

```bash
# Stop the web service so it doesn't write during restore
docker compose -f docker-compose.prod.yml --env-file apps/web/.env.production stop web

# Restore
docker compose -f docker-compose.prod.yml --env-file apps/web/.env.production \
  exec -T postgres psql -U commons -d commons_prod < /opt/backups/your-backup.sql

# Restart
docker compose -f docker-compose.prod.yml --env-file apps/web/.env.production start web
```

---

## Monitoring logs

Stream all logs:

```bash
docker compose -f docker-compose.prod.yml --env-file apps/web/.env.production logs -f
```

Stream only the web application:

```bash
docker compose -f docker-compose.prod.yml --env-file apps/web/.env.production logs -f web
```

Stream only Caddy (useful for certificate issues):

```bash
docker compose -f docker-compose.prod.yml --env-file apps/web/.env.production logs -f caddy
```

---

## Disk and memory

Check disk usage:

```bash
df -h
docker system df
```

Check memory:

```bash
free -m
```

If the build repeatedly runs out of memory or the VPS is consistently above 80% CPU under normal load, upgrade to the next VPS tier.

---

## Restoring from a Hostinger snapshot

If the VPS becomes unrecoverable, restore the Hostinger snapshot from the control panel. Then SSH in, start the services, and verify:

```bash
cd /opt/commons
docker compose -f docker-compose.prod.yml --env-file apps/web/.env.production up -d
docker compose -f docker-compose.prod.yml --env-file apps/web/.env.production ps
```

---

## Security notes

- PostgreSQL is not exposed to the internet — only Caddy and the web container can reach it.
- The Next.js server is not directly reachable — only Caddy proxies to it.
- Caddy handles TLS termination and automatic certificate renewal.
- Session cookies are signed with `SESSION_SECRET`. Rotating this secret invalidates all existing sessions.
- Never commit `apps/web/.env.production`. It is excluded by `.gitignore`.
