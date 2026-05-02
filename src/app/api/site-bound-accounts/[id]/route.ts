import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as Partial<{
    rateMultiplierOverride: number | null;
  }>;
  const data: Record<string, unknown> = {};
  if ("rateMultiplierOverride" in body) {
    data.rateMultiplierOverride =
      body.rateMultiplierOverride == null ||
      Number.isNaN(Number(body.rateMultiplierOverride))
        ? null
        : Number(body.rateMultiplierOverride);
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
  return NextResponse.json({
    item: { ...item, todayTokens: item.todayTokens.toString() },
  });
}
