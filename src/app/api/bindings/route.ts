import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { recomputeAllDailyProfits } from "@/lib/history";

export const runtime = "nodejs";

export async function GET() {
  const items = await prisma.binding.findMany({
    where: { upstreamKey: { upstreamAccount: { hidden: false } } },
    orderBy: { id: "asc" },
    include: {
      upstreamKey: { include: { upstreamAccount: true } },
      siteBoundAccount: { include: { siteAccount: true } },
    },
  });
  const safe = items.map((b) => ({
    ...b,
    siteBoundAccount: {
      ...b.siteBoundAccount,
      todayTokens: b.siteBoundAccount.todayTokens.toString(),
    },
  }));
  return NextResponse.json({ items: safe });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Partial<{
    siteBoundAccountId: number;
    upstreamKeyId: number;
    // 历史 binding 用——填写后该 binding 只对这段时间有效。
    // createdAt 默认为现在 (sql default), endedAt 默认 null (= 当前生效)
    createdAt: string | null;
    endedAt: string | null;
  }>;
  const { siteBoundAccountId, upstreamKeyId } = body;
  if (!siteBoundAccountId || !upstreamKeyId) {
    return NextResponse.json(
      { error: "siteBoundAccountId, upstreamKeyId required" },
      { status: 400 },
    );
  }
  try {
    const data: {
      siteBoundAccountId: number;
      upstreamKeyId: number;
      createdAt?: Date;
      endedAt?: Date;
    } = { siteBoundAccountId, upstreamKeyId };
    if (body.createdAt) {
      const d = new Date(body.createdAt);
      if (!isNaN(d.getTime())) data.createdAt = d;
    }
    if (body.endedAt) {
      const d = new Date(body.endedAt);
      if (!isNaN(d.getTime())) data.endedAt = d;
    }
    const item = await prisma.binding.create({ data });
    await recomputeAllDailyProfits().catch((e) =>
      console.error("[binding create recompute] failed:", e),
    );
    return NextResponse.json({ item });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
