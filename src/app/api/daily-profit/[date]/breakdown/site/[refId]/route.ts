import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { recomputeDailyProfitForDate } from "@/lib/history";

export const runtime = "nodejs";

// 设置 / 清除某天某 site 账号的"手动收入"/ "手动 1× 本站"/"手动支出"。
// PATCH body: {
//   manualActualCost?: number | null,  // 收入
//   manualCost?:       number | null,  // 1× 本站
//   manualExpense?:    number | null,  // 支出 (仅对未绑定行有意义,per-day,
//                                        不影响其他日期; 跟全局的 fixedCost 区别)
// }
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
    manualExpense: number | null;
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
  if ("manualExpense" in body) {
    const v = body.manualExpense;
    if (v != null && (!Number.isFinite(v) || v < 0)) {
      return NextResponse.json({ error: "manualExpense 非法" }, { status: 400 });
    }
    data.manualExpense = v == null ? null : v;
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "no fields supplied" }, { status: 400 });
  }
  try {
    const row = await prisma.dailyProfitBreakdown.upsert({
      where: { date_kind_refId: { date, kind: "site", refId: id } },
      // upsert 而不是 update — 该 site 当日可能根本没 synced row (revenue=0
      // 但 用户想设个手动支出做账, 比如线下结算)。upsert 时 create 必填
      // 字段: label/cost/actualCost 全填 0/空, 真正同步发生时再被覆盖。
      update: data,
      create: {
        date,
        kind: "site",
        refId: id,
        label: "(manual entry)",
        cost: 0,
        actualCost: 0,
        ...data,
      },
      select: { actualCost: true, manualActualCost: true, cost: true, manualCost: true, manualExpense: true },
    });
    await recomputeDailyProfitForDate(date);
    return NextResponse.json({ ok: true, row });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 404 },
    );
  }
}
