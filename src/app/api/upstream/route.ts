import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureScheduler } from "@/lib/scheduler";
import { refreshUpstreamAccount } from "@/lib/sync";

export const runtime = "nodejs";

export async function GET() {
  await ensureScheduler();
  const items = await prisma.upstreamAccount.findMany({
    orderBy: { id: "asc" },
    include: { _count: { select: { keys: true } } },
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
  const created = await prisma.upstreamAccount.create({
    data: { name, type, baseUrl, email, password },
  });
  // fire-and-forget: pull structure once so the user can bind right away
  refreshUpstreamAccount(created.id).catch((e) => {
    console.error("[upstream create] initial refresh failed:", e);
  });
  return NextResponse.json({ item: created });
}
