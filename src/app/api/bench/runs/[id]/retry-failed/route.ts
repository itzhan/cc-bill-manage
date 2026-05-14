import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { retryTasks } from "@/lib/bench";

export const runtime = "nodejs";

// POST /api/bench/runs/[id]/retry-failed
// 一键把整个 run 里所有 status=error 的题重置成 pending 并重启引擎。
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const runId = Number(id);
  if (!Number.isFinite(runId)) {
    return NextResponse.json({ error: "invalid run id" }, { status: 400 });
  }
  const failed = await prisma.benchTask.findMany({
    where: { runId, status: "error" },
    select: { id: true },
  });
  if (failed.length === 0) {
    return NextResponse.json({ ok: true, restarted: 0 });
  }
  try {
    const r = await retryTasks(
      runId,
      failed.map((t) => t.id),
    );
    return NextResponse.json({ ok: true, restarted: r.restarted });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 409 },
    );
  }
}
