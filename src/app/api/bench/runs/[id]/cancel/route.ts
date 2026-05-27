import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// 强行终止:
//   1. cancelRequested=true — 引擎 between-task 轮询会停手, 不再 queue 新任务
//   2. status=canceled — 立刻让 UI 状态变成"取消", 不用等引擎打完手头的
//      in-flight (LLM 调用可能 30s+ 才回)。引擎最后 finalizeRun 也会写
//      status=canceled, 同值幂等无副作用。
//   3. finishedAt 也补上, 给 UI 显示时间
// 已经 done/error/canceled 的 run 调用本接口也安全(再次写同样字段)。
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const runId = Number(id);
  const run = await prisma.benchRun.findUnique({ where: { id: runId } });
  if (!run) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  await prisma.benchRun.update({
    where: { id: runId },
    data: {
      cancelRequested: true,
      status: "canceled",
      finishedAt: run.finishedAt ?? new Date(),
    },
  });
  return NextResponse.json({ ok: true, status: "canceled" });
}
