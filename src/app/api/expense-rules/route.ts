import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { recomputeAllDailyProfits } from "@/lib/history";

export const runtime = "nodejs";

export async function GET() {
  const items = await prisma.expenseRule.findMany({ orderBy: { id: "asc" } });
  return NextResponse.json({ items });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Partial<{
    prefix: string;
    suffix: string | null;
    fixedCost: number;
    notes: string | null;
  }>;
  const prefix = (body.prefix ?? "").trim();
  const suffix = (body.suffix ?? "")?.trim() || null;
  const fixedCost = Number(body.fixedCost);
  if (!prefix && !suffix) {
    return NextResponse.json(
      { error: "prefix 和 suffix 至少填一个" },
      { status: 400 },
    );
  }
  if (!Number.isFinite(fixedCost) || fixedCost < 0) {
    return NextResponse.json({ error: "fixedCost 数值非法" }, { status: 400 });
  }
  try {
    const item = await prisma.expenseRule.create({
      data: { prefix, suffix, fixedCost, notes: body.notes ?? null },
    });
    await recomputeAllDailyProfits().catch((e) =>
      console.error("[expense-rule create recompute] failed:", e),
    );
    return NextResponse.json({ item });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
