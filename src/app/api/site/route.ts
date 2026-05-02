import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureScheduler } from "@/lib/scheduler";
import { refreshSiteAccount } from "@/lib/sync";

export const runtime = "nodejs";

export async function GET() {
  await ensureScheduler();
  const items = await prisma.siteAccount.findMany({
    orderBy: { id: "asc" },
    include: { _count: { select: { accounts: true } } },
  });
  return NextResponse.json({ items });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Partial<{
    name: string;
    type: string;
    baseUrl: string;
    email: string;
    password: string;
  }>;
  const { name, type = "sub2api", baseUrl, email, password } = body;
  if (!name || !baseUrl || !email || !password) {
    return NextResponse.json(
      { error: "name, baseUrl, email, password required" },
      { status: 400 },
    );
  }
  const created = await prisma.siteAccount.create({
    data: { name, type, baseUrl, email, password },
  });
  refreshSiteAccount(created.id).catch((e) => {
    console.error("[site create] initial refresh failed:", e);
  });
  return NextResponse.json({ item: created });
}
