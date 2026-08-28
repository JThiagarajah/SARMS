// DESTRUCTIVE: drops every SARMS table and recreates them from schema.sql, wiping all data.
// Used by `npm run db:reset` — the Postgres equivalent of the old "delete dev.db and recreate"
// SQLite workflow. Never run this against a database you care about.
import { db, initDb, closeDb } from "./client";

(async () => {
  const tables = (await db
    .prepare("SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public'")
    .all()) as { name: string }[];

  if (tables.length > 0) {
    const dropList = tables.map((t) => `"${t.name}"`).join(", ");
    await db.prepare(`DROP TABLE IF EXISTS ${dropList} CASCADE`).run();
    console.log(`Dropped ${tables.length} table(s).`);
  }

  await initDb();
  console.log(`SARMS database reset and re-created at ${process.env.DATABASE_URL ?? "(DATABASE_URL not set)"}`);
  await closeDb();
})().catch((err) => {
  console.error("Reset failed:", err);
  process.exit(1);
});
