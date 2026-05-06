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
console.log("bench tables migrated");
await prisma.$disconnect();
