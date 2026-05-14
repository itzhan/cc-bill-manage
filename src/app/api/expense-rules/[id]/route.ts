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
    prefix: string;
    fixedCost: number;
    notes: string | null;
  }>;
  const data: Record<string, unknown> = {};
  if (typeof body.prefix === "string" && body.prefix.trim()) data.prefix = body.prefix.trim();
  if (body.fixedCost != null) {
    const v = Number(body.fixedCost);
    if (!Number.isFinite(v) || v < 0) {
      return NextResponse.json({ error: "fixedCost 非法" }, { status: 400 });
    }
    data.fixedCost = v;
  }
  if (body.notes !== undefined) data.notes = body.notes;
  try {
    const item = await prisma.expenseRule.update({ where: { id: Number(id) }, data });
    await recomputeAllDailyProfits().catch((e) =>
      console.error("[expense-rule patch recompute] failed:", e),
    );
    return NextResponse.json({ item });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  try {
    await prisma.expenseRule.delete({ where: { id: Number(id) } });
    await recomputeAllDailyProfits().catch((e) =>
      console.error("[expense-rule delete recompute] failed:", e),
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
