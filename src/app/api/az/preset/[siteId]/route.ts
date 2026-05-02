import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { readConfig, DEFAULT_AZ_CONFIG, type AzConfig } from "@/lib/az";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ siteId: string }> },
) {
  const { siteId } = await ctx.params;
  const id = Number(siteId);
  const row = await prisma.azPreset.findUnique({
    where: { siteAccountId: id },
  });
  return NextResponse.json({
    config: row ? readConfig(row.config) : DEFAULT_AZ_CONFIG,
    updatedAt: row?.updatedAt ?? null,
  });
}

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ siteId: string }> },
) {
  const { siteId } = await ctx.params;
  const id = Number(siteId);
  const body = (await req.json().catch(() => ({}))) as Partial<AzConfig>;
  const config = JSON.stringify({ ...DEFAULT_AZ_CONFIG, ...body });
  const row = await prisma.azPreset.upsert({
    where: { siteAccountId: id },
    create: { siteAccountId: id, config },
    update: { config },
  });
  return NextResponse.json({
    config: readConfig(row.config),
    updatedAt: row.updatedAt,
  });
}
