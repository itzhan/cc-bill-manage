import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { maybeSendGroupOutageAlert } from "@/lib/mailer";

export const runtime = "nodejs";

interface Body {
  siteId?: number;
  groupId?: number;
  groupName?: string;
  totalAccounts?: number;
  failingAccounts?: Array<{ name?: string; error?: string }>;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Body;
  const siteId = Number(body.siteId);
  const groupId = Number(body.groupId);
  const groupName = String(body.groupName ?? "").trim();
  const totalAccounts = Number(body.totalAccounts) || 0;
  if (!siteId || !groupId || !groupName) {
    return NextResponse.json(
      { error: "siteId, groupId, groupName required" },
      { status: 400 },
    );
  }
  const failingAccounts = (body.failingAccounts ?? [])
    .slice(0, 50)
    .map((x) => ({
      name: String(x?.name ?? ""),
      error: x?.error ? String(x.error).slice(0, 500) : undefined,
    }))
    .filter((x) => x.name);
  const site = await prisma.siteAccount.findUnique({
    where: { id: siteId },
    select: { name: true },
  });
  const r = await maybeSendGroupOutageAlert({
    siteId,
    groupId,
    siteName: site?.name ?? `站点 ${siteId}`,
    groupName,
    totalAccounts,
    failingAccounts,
  });
  return NextResponse.json(r);
}
