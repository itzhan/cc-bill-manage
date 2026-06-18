import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const dbId = Number(id);
  if (!Number.isFinite(dbId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const body = (await req.json().catch(() => ({}))) as Partial<{
    name: string;
    userIds: number[];
    groupIds: number[];
  }>;
  const data: Record<string, unknown> = {};
  if (typeof body.name === "string") data.name = body.name.trim();
  if (Array.isArray(body.userIds)) {
    data.userIdsJson = JSON.stringify(
      body.userIds.filter((n) => Number.isFinite(n)),
    );
  }
  if (Array.isArray(body.groupIds)) {
    data.groupIdsJson = JSON.stringify(
      body.groupIds.filter((n) => Number.isFinite(n)),
    );
  }
  const item = await prisma.publicShare
    .update({ where: { id: dbId }, data })
    .catch(() => null);
  if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ item });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const dbId = Number(id);
  if (!Number.isFinite(dbId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  await prisma.publicShare.delete({ where: { id: dbId } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
