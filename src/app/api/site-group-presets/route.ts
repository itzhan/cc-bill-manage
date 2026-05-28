import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// GET /api/site-group-presets?siteAccountId=N → list (filter optional)
// POST /api/site-group-presets { siteAccountId, name, groupIds } → create

function parseGroupIds(raw: string): number[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v)
      ? v.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0)
      : [];
  } catch {
    return [];
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const siteIdStr = url.searchParams.get("siteAccountId");
  const siteId = siteIdStr ? Number(siteIdStr) : null;
  const where = siteId != null ? { siteAccountId: siteId } : undefined;
  const items = await prisma.siteGroupPreset.findMany({
    where,
    orderBy: [{ siteAccountId: "asc" }, { id: "asc" }],
  });
  return NextResponse.json({
    items: items.map((p) => ({
      id: p.id,
      siteAccountId: p.siteAccountId,
      name: p.name,
      groupIds: parseGroupIds(p.groupIdsJson),
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
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
  const groupIds = (body.groupIds ?? [])
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!siteAccountId || !name || groupIds.length === 0) {
    return NextResponse.json(
      { error: "siteAccountId / name / groupIds 必填" },
      { status: 400 },
    );
  }
  const created = await prisma.siteGroupPreset.create({
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
