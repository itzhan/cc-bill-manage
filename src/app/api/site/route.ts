import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureScheduler } from "@/lib/scheduler";
import { refreshSiteAccount } from "@/lib/sync";

export const runtime = "nodejs";

export async function GET(req: Request) {
  await ensureScheduler();
  const url = new URL(req.url);
  const showHidden = url.searchParams.get("hidden") === "1";
  const showAll = url.searchParams.get("all") === "1";
  const items = await prisma.siteAccount.findMany({
    where: showAll ? undefined : { hidden: showHidden },
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
    apiKey: string;
  }>;
  const {
    name,
    type = "sub2api",
    baseUrl,
    email = "",
    password = "",
    apiKey,
  } = body;
  if (!name || !baseUrl) {
    return NextResponse.json(
      { error: "name 和 baseUrl 必填" },
      { status: 400 },
    );
  }
  // Need either apiKey OR (email + password). Email/password without apiKey
  // remain the legacy login path; with apiKey they're record-only.
  if (!apiKey && (!email || !password)) {
    return NextResponse.json(
      { error: "需要提供 apiKey，或同时提供 email + password" },
      { status: 400 },
    );
  }
  const created = await prisma.siteAccount.create({
    data: { name, type, baseUrl, email, password, apiKey: apiKey ?? null },
  });
  refreshSiteAccount(created.id).catch((e) => {
    console.error("[site create] initial refresh failed:", e);
  });
  return NextResponse.json({ item: created });
}
