import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// 设置 / 清除某天某 site 账号的"手动收入"/ "手动 1× 本站"。
// PATCH body: { manualActualCost?: number | null, manualCost?: number | null }
//   number → 设手动值；后续 sync/backfill 不会再覆盖
//   null   → 清除手动值，恢复 synced
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
    manualCost: number | null;
  }>;
  const data: Record<string, unknown> = {};
  if ("manualActualCost" in body) {
    const v = body.manualActualCost;
    if (v != null && (!Number.isFinite(v) || v < 0)) {
      return NextResponse.json({ error: "manualActualCost 非法" }, { status: 400 });
    }
    data.manualActualCost = v == null ? null : v;
  }
  if ("manualCost" in body) {
    const v = body.manualCost;
    if (v != null && (!Number.isFinite(v) || v < 0)) {
      return NextResponse.json({ error: "manualCost 非法" }, { status: 400 });
    }
    data.manualCost = v == null ? null : v;
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "no fields supplied" }, { status: 400 });
  }
  try {
    const row = await prisma.dailyProfitBreakdown.update({
      where: { date_kind_refId: { date, kind: "site", refId: id } },
      data,
      select: { actualCost: true, manualActualCost: true, cost: true, manualCost: true },
    });
    return NextResponse.json({ ok: true, row });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 404 },
    );
  }
}
