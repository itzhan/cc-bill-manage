import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { recomputeAllDailyProfits } from "@/lib/history";

export const runtime = "nodejs";

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as Partial<{
    rateMultiplierOverride: number | null;
    fixedCost: number | null;
  }>;
  const data: Record<string, unknown> = {};
  if ("rateMultiplierOverride" in body) {
    data.rateMultiplierOverride =
      body.rateMultiplierOverride == null ||
      Number.isNaN(Number(body.rateMultiplierOverride))
        ? null
        : Number(body.rateMultiplierOverride);
  }
  if ("fixedCost" in body) {
    if (body.fixedCost == null) {
      data.fixedCost = null;
    } else {
      const v = Number(body.fixedCost);
      if (!Number.isFinite(v) || v < 0) {
        return NextResponse.json(
          { error: "fixedCost 数值非法" },
          { status: 400 },
        );
      }
      data.fixedCost = v;
    }
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: "no editable fields supplied" },
      { status: 400 },
    );
  }
  const item = await prisma.siteBoundAccount.update({
    where: { id: Number(id) },
    data,
  });
  // fixedCost 影响每天的"未绑定账号支出"计算 → 全量重算 DailyProfit
  if ("fixedCost" in data) {
    await recomputeAllDailyProfits().catch((e) =>
      console.error("[site-bound recompute] failed:", e),
    );
  }
  return NextResponse.json({
    item: { ...item, todayTokens: item.todayTokens.toString() },
  });
}
