import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// PATCH a single UpstreamKey row. Currently only `rechargeMultiplier`
// is editable from the UI — discount factor for the credits we hold.
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as Partial<{
    rechargeMultiplier: number;
  }>;
  const data: Record<string, unknown> = {};
  if (typeof body.rechargeMultiplier === "number") {
    if (!Number.isFinite(body.rechargeMultiplier) || body.rechargeMultiplier < 0) {
      return NextResponse.json(
        { error: "rechargeMultiplier must be a non-negative number" },
        { status: 400 },
      );
    }
    data.rechargeMultiplier = body.rechargeMultiplier;
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "no editable field provided" }, {
      status: 400,
    });
  }
  const item = await prisma.upstreamKey.update({
    where: { id: Number(id) },
    data,
  });
  return NextResponse.json({ item });
}
