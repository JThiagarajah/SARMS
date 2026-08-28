// Applies schema.sql against DATABASE_URL. Safe to re-run (every statement is IF NOT EXISTS)
// — this only ever adds tables/indexes, never drops or truncates anything.
import { db, initDb, closeDb } from "./client";

(async () => {
  await initDb();
  const tables = (await db
    .prepare("SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename")
    .all()) as { name: string }[];

  console.log(`SARMS database ready at ${process.env.DATABASE_URL ?? "(DATABASE_URL not set)"}`);
  console.log(`Tables (${tables.length}):`, tables.map((t) => t.name).join(", "));
  await closeDb();
})().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
