import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// List custom groups, optionally filtered by site account.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const siteIdStr = url.searchParams.get("siteId");
  const siteId = siteIdStr ? Number(siteIdStr) : null;
  const where = siteId != null ? { siteAccountId: siteId } : undefined;
  const items = await prisma.customGroup.findMany({
    where,
    orderBy: { id: "asc" },
  });
  return NextResponse.json({
    items: items.map((g) => ({
      id: g.id,
      siteAccountId: g.siteAccountId,
      name: g.name,
      groupIds: parseGroupIds(g.groupIdsJson),
      createdAt: g.createdAt,
      updatedAt: g.updatedAt,
    })),
  });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Partial<{
    siteAccountId: number;
    name: string;
    groupIds: number[];
  }>;
  const siteAccountId = Number(body.siteAccountId);
  const name = (body.name ?? "").trim();
  const groupIds = (body.groupIds || [])
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n));
  if (!siteAccountId || !name || groupIds.length === 0) {
    return NextResponse.json(
      { error: "siteAccountId, name, groupIds required" },
      { status: 400 },
    );
  }
  const created = await prisma.customGroup.create({
    data: {
      siteAccountId,
      name,
      groupIdsJson: JSON.stringify(groupIds),
    },
  });
  return NextResponse.json({
    item: {
      id: created.id,
      siteAccountId: created.siteAccountId,
      name: created.name,
      groupIds,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    },
  });
}

function parseGroupIds(raw: string): number[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v)
      ? v.map((x) => Number(x)).filter((x) => Number.isFinite(x))
      : [];
  } catch {
    return [];
  }
}
