import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// 设置 / 清除某天某 upstream key 的"手动支出"。
// PATCH body: { manualActualCost: number | null }
//   - number → 设手动值；后续 sync/backfill 不会再覆盖
//   - null   → 清除手动值，恢复 synced actualCost
//
// 行必须已经存在（即至少同步/回填过一次）。不存在时返回 404。
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ date: string; refId: string }> },
) {
  const { date, refId } = await ctx.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date 必须 YYYY-MM-DD" }, { status: 400 });
  }
  const id = Number(refId);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "invalid refId" }, { status: 400 });
  }
  const body = (await req.json().catch(() => ({}))) as Partial<{
    manualActualCost: number | null;
  }>;
  const v = body.manualActualCost;
  if (v != null && (!Number.isFinite(v) || v < 0)) {
    return NextResponse.json({ error: "数值非法" }, { status: 400 });
  }
  try {
    const row = await prisma.dailyProfitBreakdown.update({
      where: {
        date_kind_refId: { date, kind: "upstream", refId: id },
      },
      data: { manualActualCost: v == null ? null : v },
      select: { actualCost: true, manualActualCost: true },
    });
    return NextResponse.json({ ok: true, row });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 404 },
    );
  }
}
