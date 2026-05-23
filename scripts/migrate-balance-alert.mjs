// Idempotent migration: adds balance-alert columns to UpstreamAccount on
// existing SQLite DBs (server already has data and we don't want to wipe).
// Safe to run repeatedly — checks each column before ALTER.
//
// Run on host:
//   docker exec bill-manage node scripts/migrate-balance-alert.mjs
// Or wire into Dockerfile CMD so it auto-runs every container start.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const COLUMNS = [
  ["balanceAlertEnabled", `"balanceAlertEnabled" BOOLEAN NOT NULL DEFAULT false`],
  ["balanceAlertIntervalMin", `"balanceAlertIntervalMin" INTEGER NOT NULL DEFAULT 60`],
  ["balanceAlertThresholdsJson", `"balanceAlertThresholdsJson" TEXT`],
  ["balanceAlertFiredJson", `"balanceAlertFiredJson" TEXT`],
  ["balanceAlertLastCheckAt", `"balanceAlertLastCheckAt" DATETIME`],
];

async function existingCols() {
  const rows = await prisma.$queryRawUnsafe(
    `PRAGMA table_info("UpstreamAccount")`,
  );
  return new Set(rows.map((r) => r.name));
}

async function main() {
  const have = await existingCols();
  let added = 0;
  for (const [col, def] of COLUMNS) {
    if (have.has(col)) continue;
    const sql = `ALTER TABLE "UpstreamAccount" ADD COLUMN ${def}`;
    console.log(`[migrate-balance-alert] ${sql}`);
    await prisma.$executeRawUnsafe(sql);
    added++;
  }
  if (added === 0) {
    console.log("[migrate-balance-alert] already up-to-date");
  } else {
    console.log(`[migrate-balance-alert] added ${added} column(s)`);
  }
}

main()
  .catch((e) => {
    console.error("[migrate-balance-alert] failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
