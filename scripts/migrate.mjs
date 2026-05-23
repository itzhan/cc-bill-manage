// Idempotent incremental schema migration for existing SQLite DBs.
// Adds columns that are listed in MANIFEST but not yet on the table.
// Safe to run on every container start.
//
// Conventions:
//   - SQLite only supports ADD COLUMN (no MODIFY / DROP), so we only
//     add new nullable / DEFAULT-ed columns; structural rewrites need
//     a dedicated script (see scripts/migrate-bench-tables.mjs).
//   - Run from any working dir as long as DATABASE_URL points at the DB.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const MANIFEST = [
  {
    table: "UpstreamAccount",
    columns: [
      ["balanceAlertEnabled", `"balanceAlertEnabled" BOOLEAN NOT NULL DEFAULT false`],
      ["balanceAlertIntervalMin", `"balanceAlertIntervalMin" INTEGER NOT NULL DEFAULT 60`],
      ["balanceAlertThresholdsJson", `"balanceAlertThresholdsJson" TEXT`],
      ["balanceAlertFiredJson", `"balanceAlertFiredJson" TEXT`],
      ["balanceAlertLastCheckAt", `"balanceAlertLastCheckAt" DATETIME`],
    ],
  },
  {
    table: "Settings",
    columns: [
      ["unboundExcludeSuffixes", `"unboundExcludeSuffixes" TEXT`],
    ],
  },
];

async function existingCols(table) {
  const rows = await prisma.$queryRawUnsafe(
    `PRAGMA table_info("${table}")`,
  );
  return new Set(rows.map((r) => r.name));
}

async function main() {
  let added = 0;
  for (const { table, columns } of MANIFEST) {
    const have = await existingCols(table);
    for (const [col, def] of columns) {
      if (have.has(col)) continue;
      const sql = `ALTER TABLE "${table}" ADD COLUMN ${def}`;
      console.log(`[migrate] ${sql}`);
      await prisma.$executeRawUnsafe(sql);
      added++;
    }
  }
  if (added === 0) {
    console.log("[migrate] schema already up-to-date");
  } else {
    console.log(`[migrate] added ${added} column(s)`);
  }
}

main()
  .catch((e) => {
    console.error("[migrate] failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
