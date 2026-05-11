import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

const STATUSES = new Set(["discussing", "pending_test", "tested"]);

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const numId = Number(id);
  if (!Number.isFinite(numId)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }
  const body = (await req.json().catch(() => ({}))) as Partial<{
    partnerName: string;
    status: string;
    goal: string;
    siteUrl: string | null;
  }>;

  const data: Record<string, unknown> = {};
  if (body.partnerName !== undefined) {
    const v = body.partnerName?.trim();
    if (!v) return NextResponse.json({ error: "合作方名称不能为空" }, { status: 400 });
    data.partnerName = v;
  }
  if (body.status !== undefined) {
    if (!STATUSES.has(body.status)) {
      return NextResponse.json({ error: "status 非法" }, { status: 400 });
    }
    data.status = body.status;
  }
  if (body.goal !== undefined) data.goal = body.goal ?? "";
  if (body.siteUrl !== undefined) data.siteUrl = body.siteUrl?.trim() || null;

  const item = await prisma.project.update({ where: { id: numId }, data });
  return NextResponse.json({ item });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const numId = Number(id);
  if (!Number.isFinite(numId)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }
  await prisma.project.delete({ where: { id: numId } });
  return NextResponse.json({ ok: true });
}
