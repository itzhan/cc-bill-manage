import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sampleByConfig } from "@/lib/bench-dataset";
import { startInBackground } from "@/lib/bench";

export const runtime = "nodejs";

export async function GET() {
  const items = await prisma.benchRun.findMany({
    orderBy: { id: "desc" },
    select: {
      id: true,
      name: true,
      baseUrl: true,
      apiKeyMasked: true,
      model: true,
      effort: true,
      n: true,
      seed: true,
      concurrency: true,
      status: true,
      totalCount: true,
      completedCount: true,
      failedCount: true,
      mustHavePassRate: true,
      taskResolveRate: true,
      avgAnswerLatencyS: true,
      hasSignature: true,
      serviceTierPresent: true,
      cacheCreationPresent: true,
      totalThinkingChars: true,
      startedAt: true,
      finishedAt: true,
      createdAt: true,
    },
  });
  return NextResponse.json({ items });
}

function mask(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return key.replace(/./g, "*");
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Partial<{
    name: string;
    baseUrl: string;
    apiKey: string;
    model: string;
    judgeModel: string;
    effort: string;
    judgeEffort: string;
    n: number;
    seed: number;
    concurrency: number;
  }>;
  const name = (body.name ?? "").trim();
  const baseUrl = (body.baseUrl ?? "").trim().replace(/\/$/, "");
  const apiKey = (body.apiKey ?? "").trim();
  if (!name || !baseUrl || !apiKey) {
    return NextResponse.json({ error: "name, baseUrl, apiKey are required" }, { status: 400 });
  }
  const n = Math.max(1, Math.min(124, body.n ?? 30));
  const seed = body.seed ?? 42;
  const concurrency = Math.max(1, Math.min(30, body.concurrency ?? 10));
  const effort = body.effort ?? "high";
  const judgeEffort = body.judgeEffort ?? "high";
  const model = (body.model ?? "claude-opus-4-7").trim();
  const judgeModel = (body.judgeModel ?? model).trim();

  const samples = await sampleByConfig(n, seed);
  if (samples.length === 0) {
    return NextResponse.json({ error: "no samples for given (n, seed)" }, { status: 400 });
  }

  const run = await prisma.benchRun.create({
    data: {
      name,
      baseUrl,
      apiKey,
      apiKeyMasked: mask(apiKey),
      model,
      judgeModel,
      effort,
      judgeEffort,
      n,
      seed,
      concurrency,
      totalCount: samples.length,
      tasks: {
        create: samples.map((s) => ({
          taskId: s.task_id,
          category: s.category,
          language: s.language,
          repo: s.repository_url,
        })),
      },
    },
  });

  startInBackground(run.id);

  return NextResponse.json({ id: run.id });
}
