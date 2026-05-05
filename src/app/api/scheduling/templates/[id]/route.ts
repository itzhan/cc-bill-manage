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
    siteAccountId: number | null;
    platform: string;
    type: string;
    rateMultiplier: number;
    groupIds: number[];
    modelList: string[];
    confirmMixedChannelRisk: boolean;
    notes: string | null;
  }>;
  const data: Record<string, unknown> = {};
  if (body.name != null) data.name = body.name;
  if (body.siteAccountId !== undefined) data.siteAccountId = body.siteAccountId;
  if (body.platform != null) data.platform = body.platform;
  if (body.type != null) data.type = body.type;
  if (body.rateMultiplier != null) data.rateMultiplier = body.rateMultiplier;
  if (body.groupIds != null) data.groupIds = JSON.stringify(body.groupIds);
  if (body.modelList != null) data.modelList = JSON.stringify(body.modelList);
  if (body.confirmMixedChannelRisk != null)
    data.confirmMixedChannelRisk = body.confirmMixedChannelRisk;
  if (body.notes !== undefined) data.notes = body.notes;
  const item = await prisma.schedulingTemplate.update({
    where: { id: Number(id) },
    data,
  });
  return NextResponse.json({ item });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  await prisma.schedulingTemplate.delete({ where: { id: Number(id) } });
  return NextResponse.json({ ok: true });
}
