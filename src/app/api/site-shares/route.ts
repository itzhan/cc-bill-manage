import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { newShareId } from "@/lib/share-id";

export const runtime = "nodejs";

export async function GET() {
  const items = await prisma.publicShare.findMany({
    orderBy: { id: "desc" },
    include: {
      siteAccount: { select: { id: true, name: true, baseUrl: true } },
    },
  });
  return NextResponse.json({ items });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Partial<{
    siteAccountId: number;
    name: string;
    userIds: number[];
    groupIds: number[];
  }>;
  const siteAccountId = Number(body.siteAccountId);
  if (!Number.isFinite(siteAccountId)) {
    return NextResponse.json({ error: "siteAccountId 必填" }, { status: 400 });
  }
  const site = await prisma.siteAccount.findUnique({
    where: { id: siteAccountId },
  });
  if (!site) {
    return NextResponse.json({ error: "siteAccount 不存在" }, { status: 404 });
  }

  // 撞 unique 几乎不可能, 出现就重试一次。
  let shareId = newShareId();
  for (let i = 0; i < 3; i++) {
    const exist = await prisma.publicShare.findUnique({ where: { shareId } });
    if (!exist) break;
    shareId = newShareId();
  }

  const userIds = Array.isArray(body.userIds)
    ? body.userIds.filter((n) => Number.isFinite(n))
    : [];
  const groupIds = Array.isArray(body.groupIds)
    ? body.groupIds.filter((n) => Number.isFinite(n))
    : [];

  const item = await prisma.publicShare.create({
    data: {
      shareId,
      siteAccountId,
      name: body.name?.trim() ?? "",
      userIdsJson: JSON.stringify(userIds),
      groupIdsJson: JSON.stringify(groupIds),
    },
  });
  return NextResponse.json({ item });
}
