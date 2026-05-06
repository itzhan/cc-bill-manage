import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// Sets cancelRequested=true; the engine polls this between tasks and
// stops queueing new work. In-flight tasks finish gracefully.
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  await prisma.benchRun.update({
    where: { id: Number(id) },
    data: { cancelRequested: true },
  });
  return NextResponse.json({ ok: true });
}
