import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as Partial<{
    name: string;
    groupIds: number[];
  }>;
  const data: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) {
    data.name = body.name.trim();
  }
  if (Array.isArray(body.groupIds)) {
    const groupIds = body.groupIds
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (groupIds.length === 0) {
      return NextResponse.json(
        { error: "groupIds 至少 1 个" },
        { status: 400 },
      );
    }
    data.groupIdsJson = JSON.stringify(groupIds);
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "无可改字段" }, { status: 400 });
  }
  await prisma.siteGroupPreset.update({
    where: { id: Number(id) },
    data,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  await prisma.siteGroupPreset.delete({ where: { id: Number(id) } });
  return NextResponse.json({ ok: true });
}
