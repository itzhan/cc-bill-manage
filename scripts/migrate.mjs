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

// 整张新表(prisma migrate 没接入, 用幂等 CREATE TABLE IF NOT EXISTS)
const NEW_TABLES = [
  {
    name: "SiteGroupPreset",
    sql: `CREATE TABLE IF NOT EXISTS "SiteGroupPreset" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "siteAccountId" INTEGER NOT NULL,
      "name" TEXT NOT NULL,
      "groupIdsJson" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY ("siteAccountId") REFERENCES "SiteAccount"("id") ON DELETE CASCADE
    )`,
    indexes: [
      `CREATE INDEX IF NOT EXISTS "SiteGroupPreset_siteAccountId_idx" ON "SiteGroupPreset"("siteAccountId")`,
    ],
  },
  {
    name: "VeridropRun",
    sql: `CREATE TABLE IF NOT EXISTS "VeridropRun" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "channelKeyId" INTEGER NOT NULL,
      "protocol" TEXT NOT NULL,
      "mode" TEXT NOT NULL,
      "model" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'queued',
      "totalScore" REAL,
      "verdict" TEXT,
      "summary" TEXT,
      "reportJson" TEXT,
      "errorText" TEXT,
      "startedAt" DATETIME,
      "finishedAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY ("channelKeyId") REFERENCES "BenchChannelKey"("id") ON DELETE CASCADE
    )`,
    indexes: [
      `CREATE INDEX IF NOT EXISTS "VeridropRun_channelKeyId_idx" ON "VeridropRun"("channelKeyId")`,
      `CREATE INDEX IF NOT EXISTS "VeridropRun_createdAt_idx" ON "VeridropRun"("createdAt")`,
    ],
  },
];

async function existingCols(table) {
  const rows = await prisma.$queryRawUnsafe(
    `PRAGMA table_info("${table}")`,
  );
  return new Set(rows.map((r) => r.name));
}

async function tableExists(name) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT name FROM sqlite_master WHERE type='table' AND name = ?`,
    name,
  );
  return rows.length > 0;
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
  for (const t of NEW_TABLES) {
    if (await tableExists(t.name)) continue;
    console.log(`[migrate] CREATE TABLE ${t.name}`);
    await prisma.$executeRawUnsafe(t.sql);
    for (const idx of t.indexes ?? []) {
      await prisma.$executeRawUnsafe(idx);
    }
    added++;
  }
  if (added === 0) {
    console.log("[migrate] schema already up-to-date");
  } else {
    console.log(`[migrate] added ${added} item(s)`);
  }
}

main()
  .catch((e) => {
    console.error("[migrate] failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
