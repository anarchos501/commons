// Creates the node-B database for the two-node federation dev harness.
// Reads DATABASE_URL from .env.node-b (run via `pnpm db:setup:node-b`, which
// passes --env-file=.env.node-b) and creates the named database on the same
// server if it does not exist. Migrations are a separate step:
// `pnpm db:migrate:node-b`.
import { Client } from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set — copy .env.node-b.example to .env.node-b first.");
  process.exit(1);
}

const target = new URL(url);
const dbName = target.pathname.replace(/^\//, "");
if (!dbName || !/^[a-z0-9_]+$/i.test(dbName)) {
  console.error(`Refusing to create database with unexpected name: ${JSON.stringify(dbName)}`);
  process.exit(1);
}

const admin = new URL(url);
admin.pathname = "/postgres";

const client = new Client({ connectionString: admin.toString() });
await client.connect();
try {
  const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
  if (exists.rowCount > 0) {
    console.log(`Database ${dbName} already exists.`);
  } else {
    await client.query(`CREATE DATABASE "${dbName}"`);
    console.log(`Created database ${dbName}.`);
  }
} finally {
  await client.end();
}
