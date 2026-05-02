import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const items = await prisma.binding.findMany({
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
  }>;
  const { siteBoundAccountId, upstreamKeyId } = body;
  if (!siteBoundAccountId || !upstreamKeyId) {
    return NextResponse.json(
      { error: "siteBoundAccountId, upstreamKeyId required" },
      { status: 400 },
    );
  }
  try {
    const item = await prisma.binding.create({
      data: { siteBoundAccountId, upstreamKeyId },
    });
    return NextResponse.json({ item });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
