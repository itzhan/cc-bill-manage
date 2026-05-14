import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { retryTasks } from "@/lib/bench";

export const runtime = "nodejs";

// POST /api/bench/runs/[id]/task/[taskId]/retry
// 把 url 里的 taskId(字符串,如 "django__django-12345") 解析成整数主键,
// 再调 retryTasks。只有当前 status=error 的题会被重置;其它状态被静默忽略。
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string; taskId: string }> },
) {
  const { id, taskId } = await ctx.params;
  const runId = Number(id);
  if (!Number.isFinite(runId)) {
    return NextResponse.json({ error: "invalid run id" }, { status: 400 });
  }
  const row = await prisma.benchTask.findFirst({
    where: { runId, taskId },
    select: { id: true, status: true },
  });
  if (!row) return NextResponse.json({ error: "task not found" }, { status: 404 });
  if (row.status !== "error") {
    return NextResponse.json(
      { error: `task is ${row.status}, only error tasks can be retried` },
      { status: 409 },
    );
  }
  try {
    const r = await retryTasks(runId, [row.id]);
    return NextResponse.json({ ok: true, restarted: r.restarted });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 409 },
    );
  }
}
