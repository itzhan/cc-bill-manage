import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// GET — reveal the full apiKey + parent channel base URL. Auth is handled
// by middleware (requires bm_session); we don't redact here because the
// whole purpose is the "复制" panel.
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const item = await prisma.benchChannelKey.findUnique({
    where: { id: Number(id) },
    include: { channel: true },
  });
  if (!item) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({
    item: {
      id: item.id,
      name: item.name,
      apiKey: item.apiKey,
      notes: item.notes,
      channel: {
        id: item.channel.id,
        name: item.channel.name,
        baseUrl: item.channel.baseUrl,
      },
    },
  });
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as Partial<{
    name: string;
    apiKey: string;
    notes: string | null;
  }>;
  const data: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
  if (typeof body.apiKey === "string" && body.apiKey.trim()) data.apiKey = body.apiKey.trim();
  if (body.notes !== undefined) data.notes = body.notes;
  const item = await prisma.benchChannelKey.update({
    where: { id: Number(id) },
    data,
  });
  return NextResponse.json({ item: { id: item.id, name: item.name } });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  await prisma.benchChannelKey.delete({ where: { id: Number(id) } });
  return NextResponse.json({ ok: true });
}
