import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const numId = Number(id);
  const body = (await req.json().catch(() => ({}))) as Partial<{
    name: string;
    groupIds: number[];
  }>;
  const data: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) {
    data.name = body.name.trim();
  }
  if (Array.isArray(body.groupIds)) {
    const ids = body.groupIds
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n));
    if (ids.length === 0) {
      return NextResponse.json(
        { error: "groupIds must be non-empty" },
        { status: 400 },
      );
    }
    data.groupIdsJson = JSON.stringify(ids);
  }
  const updated = await prisma.customGroup.update({
    where: { id: numId },
    data,
  });
  return NextResponse.json({ item: updated });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  await prisma.customGroup.delete({ where: { id: Number(id) } });
  return NextResponse.json({ ok: true });
}
