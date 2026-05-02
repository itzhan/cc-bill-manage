import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const items = await prisma.upstreamKey.findMany({
    where: { upstreamAccountId: Number(id) },
    orderBy: { id: "asc" },
  });
  return NextResponse.json({ items });
}
