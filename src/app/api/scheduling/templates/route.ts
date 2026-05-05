import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const items = await prisma.schedulingTemplate.findMany({
    orderBy: { id: "asc" },
  });
  return NextResponse.json({ items });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Partial<{
    name: string;
    siteAccountId: number | null;
    platform: string;
    type: string;
    rateMultiplier: number;
    groupIds: number[];
    modelList: string[];
    confirmMixedChannelRisk: boolean;
    notes: string;
  }>;
  if (!body.name) {
    return NextResponse.json({ error: "name 必填" }, { status: 400 });
  }
  const created = await prisma.schedulingTemplate.create({
    data: {
      name: body.name,
      siteAccountId: body.siteAccountId ?? null,
      platform: body.platform ?? "anthropic",
      type: body.type ?? "apikey",
      rateMultiplier: body.rateMultiplier ?? 1,
      groupIds: JSON.stringify(body.groupIds ?? []),
      modelList: JSON.stringify(body.modelList ?? []),
      confirmMixedChannelRisk: body.confirmMixedChannelRisk ?? true,
      notes: body.notes ?? null,
    },
  });
  return NextResponse.json({ item: created });
}
