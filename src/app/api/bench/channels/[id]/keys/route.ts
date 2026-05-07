import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// Add a new key under this channel.
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const channelId = Number(id);
  const body = (await req.json().catch(() => ({}))) as Partial<{
    name: string;
    apiKey: string;
    notes: string;
  }>;
  const name = (body.name ?? "").trim();
  const apiKey = (body.apiKey ?? "").trim();
  if (!name || !apiKey) {
    return NextResponse.json(
      { error: "name 和 apiKey 必填" },
      { status: 400 },
    );
  }
  const channel = await prisma.benchChannel.findUnique({ where: { id: channelId } });
  if (!channel) {
    return NextResponse.json({ error: "channel not found" }, { status: 404 });
  }
  const created = await prisma.benchChannelKey.create({
    data: { channelId, name, apiKey, notes: body.notes ?? null },
  });
  return NextResponse.json({ item: { id: created.id, name: created.name } });
}
