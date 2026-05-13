// Idempotent migration: creates BenchRun + BenchTask tables when they don't
// exist yet. Run inside the running container, e.g.
//   docker exec bill-manage node scripts/migrate-bench-tables.mjs
//
// SQL is the verbatim output of `sqlite3 prisma/dev.db ".schema BenchRun"`
// after `prisma db push` was applied locally — so it stays bit-for-bit
// compatible with what the Prisma client expects.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "BenchRun" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "apiKeyMasked" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT 'claude-opus-4-7',
    "judgeModel" TEXT NOT NULL DEFAULT 'claude-opus-4-7',
    "effort" TEXT NOT NULL DEFAULT 'high',
    "judgeEffort" TEXT NOT NULL DEFAULT 'high',
    "n" INTEGER NOT NULL,
    "seed" INTEGER NOT NULL DEFAULT 42,
    "concurrency" INTEGER NOT NULL DEFAULT 10,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "totalCount" INTEGER NOT NULL,
    "completedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "mustHavePassRate" REAL,
    "taskResolveRate" REAL,
    "allItemsPassRate" REAL,
    "avgAnswerLatencyS" REAL,
    "avgJudgeLatencyS" REAL,
    "totalInputTokens" INTEGER,
    "totalOutputTokens" INTEGER,
    "totalThinkingChars" INTEGER,
    "hasSignature" BOOLEAN,
    "serviceTierPresent" BOOLEAN,
    "cacheCreationPresent" BOOLEAN,
    "errorSummary" TEXT,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS "BenchRun_createdAt_idx" ON "BenchRun"("createdAt")`,
  `CREATE TABLE IF NOT EXISTS "BenchTask" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "runId" INTEGER NOT NULL,
    "taskId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "mustGot" INTEGER,
    "mustTotal" INTEGER,
    "allGot" INTEGER,
    "allTotal" INTEGER,
    "resolved" BOOLEAN,
    "answerLatencyS" REAL,
    "judgeLatencyS" REAL,
    "answerInputTokens" INTEGER,
    "answerOutputTokens" INTEGER,
    "judgeInputTokens" INTEGER,
    "judgeOutputTokens" INTEGER,
    "thinkingChars" INTEGER,
    "hasSignature" BOOLEAN,
    "answerText" TEXT,
    "judgeRawText" TEXT,
    "judgeParsedJson" TEXT,
    "errorText" TEXT,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    CONSTRAINT "BenchTask_runId_fkey" FOREIGN KEY ("runId") REFERENCES "BenchRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS "BenchTask_runId_idx" ON "BenchTask"("runId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "BenchTask_runId_taskId_key" ON "BenchTask"("runId", "taskId")`,
];

for (const sql of STATEMENTS) {
  await prisma.$executeRawUnsafe(sql);
}

// Idempotent ALTER TABLE — adds columns that were introduced after the
// initial CREATE TABLE above. Re-running is a no-op once the column exists.
async function ensureColumn(table, name, ddl) {
  const cols = await prisma.$queryRawUnsafe(`PRAGMA table_info("${table}")`);
  if (cols.some((c) => c.name === name)) return false;
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "${table}" ADD COLUMN "${name}" ${ddl}`,
  );
  console.log(`added ${table}.${name}`);
  return true;
}

// Truncation probe columns (added 2026-05).
await ensureColumn(
  "BenchRun",
  "truncProbeStatus",
  "TEXT NOT NULL DEFAULT 'not_requested'",
);
await ensureColumn("BenchRun", "truncProbeError", "TEXT");
await ensureColumn("BenchRun", "truncProbeLatencyS", "REAL");
await ensureColumn("BenchRun", "truncProbeRequestedMaxTokens", "INTEGER");
await ensureColumn("BenchRun", "truncProbeStopReason", "TEXT");
await ensureColumn("BenchRun", "truncProbeOutputTokens", "INTEGER");
await ensureColumn("BenchRun", "truncProbeThinkingChars", "INTEGER");
await ensureColumn("BenchRun", "truncProbeHasText", "BOOLEAN");
await ensureColumn("BenchRun", "truncProbeVerdict", "TEXT");
await ensureColumn("BenchRun", "truncProbeAnswerPreview", "TEXT");

// DailyProfitBreakdown — 逐 key/账号 留底，上游下线兜底。
await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "DailyProfitBreakdown" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "date" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "refId" INTEGER NOT NULL,
  "label" TEXT NOT NULL,
  "groupName" TEXT,
  "effectiveRate" REAL,
  "rechargeMultiplier" REAL,
  "upstreamAccountId" INTEGER,
  "upstreamAccountName" TEXT,
  "upstreamType" TEXT,
  "siteAccountId" INTEGER,
  "siteAccountName" TEXT,
  "rateMultiplier" REAL,
  "cost" REAL NOT NULL,
  "actualCost" REAL NOT NULL,
  "capturedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
)`);
await prisma.$executeRawUnsafe(
  `CREATE UNIQUE INDEX IF NOT EXISTS "DailyProfitBreakdown_date_kind_refId_key" ON "DailyProfitBreakdown"("date", "kind", "refId")`,
);
await prisma.$executeRawUnsafe(
  `CREATE INDEX IF NOT EXISTS "DailyProfitBreakdown_date_idx" ON "DailyProfitBreakdown"("date")`,
);

// Settings.unboundExcludePrefixes — 2026-05
await ensureColumn("Settings", "unboundExcludePrefixes", "TEXT");

// UpstreamKey.apiKey — 2026-05  (raw key value for auto-match-binding)
await ensureColumn("UpstreamKey", "apiKey", "TEXT");

// DailyProfitBreakdown.manualActualCost — 2026-05 (user override)
await ensureColumn("DailyProfitBreakdown", "manualActualCost", "REAL");

console.log("bench tables migrated");
await prisma.$disconnect();
