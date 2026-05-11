import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

const TYPES = new Set(["customer", "upstream"]);
const STATUSES = new Set(["discussing", "pending_test", "tested"]);

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type");
  const where = type && TYPES.has(type) ? { type } : {};
  const items = await prisma.project.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }],
  });
  return NextResponse.json({ items });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Partial<{
    type: string;
    partnerName: string;
    status: string;
    goal: string;
    siteUrl: string | null;
  }>;
  const { type, partnerName, status = "discussing", goal = "", siteUrl } = body;

  if (!type || !TYPES.has(type)) {
    return NextResponse.json({ error: "type 必须是 customer 或 upstream" }, { status: 400 });
  }
  if (!partnerName || !partnerName.trim()) {
    return NextResponse.json({ error: "合作方名称必填" }, { status: 400 });
  }
  if (!STATUSES.has(status)) {
    return NextResponse.json({ error: "status 非法" }, { status: 400 });
  }

  const item = await prisma.project.create({
    data: {
      type,
      partnerName: partnerName.trim(),
      status,
      goal: goal ?? "",
      siteUrl: type === "upstream" ? (siteUrl?.trim() || null) : null,
    },
  });
  return NextResponse.json({ item });
}
