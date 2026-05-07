import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { startInBackground } from "@/lib/bench";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const run = await prisma.benchRun.findUnique({
    where: { id: Number(id) },
    include: {
      tasks: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          taskId: true,
          category: true,
          language: true,
          repo: true,
          status: true,
          mustGot: true,
          mustTotal: true,
          allGot: true,
          allTotal: true,
          resolved: true,
          answerLatencyS: true,
          judgeLatencyS: true,
          answerInputTokens: true,
          answerOutputTokens: true,
          judgeInputTokens: true,
          judgeOutputTokens: true,
          thinkingChars: true,
          hasSignature: true,
          errorText: true,
        },
      },
    },
  });
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Strip sensitive fields from the response. probeRawResponse can be 30 KB;
  // surface it via a dedicated endpoint if we ever build a forensic viewer.
  const { apiKey: _apiKey, probeRawResponse: _raw, ...safe } = run;
  return NextResponse.json({ run: safe });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  await prisma.benchRun.delete({ where: { id: Number(id) } });
  return NextResponse.json({ ok: true });
}

// Re-trigger the engine in case the server restarted mid-run. Marks the run
// runnable and lets startInBackground pick up where it left off (BenchTask
// rows already in done state are skipped because executeRun only queues
// pending ones).
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const run = await prisma.benchRun.findUnique({ where: { id: Number(id) } });
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (run.status === "running") return NextResponse.json({ ok: true, already: "running" });
  await prisma.benchRun.update({
    where: { id: run.id },
    data: { status: "queued", cancelRequested: false },
  });
  startInBackground(run.id);
  return NextResponse.json({ ok: true });
}
