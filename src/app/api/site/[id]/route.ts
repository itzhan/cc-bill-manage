import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const numId = Number(id);
  const item = await prisma.siteAccount.findUnique({
    where: { id: numId },
    include: { accounts: { orderBy: { id: "asc" } } },
  });
  if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });
  // BigInts can't serialize directly
  const safe = {
    ...item,
    accounts: item.accounts.map((a) => ({ ...a, todayTokens: a.todayTokens.toString() })),
  };
  return NextResponse.json({ item: safe });
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const numId = Number(id);
  const body = (await req.json().catch(() => ({}))) as Partial<{
    name: string;
    baseUrl: string;
    email: string;
    password: string;
    apiKey: string | null;
    hidden: boolean;
  }>;
  const data: Record<string, unknown> = {};
  if (body.name != null) data.name = body.name;
  if (body.baseUrl != null) data.baseUrl = body.baseUrl;
  if (body.email != null) data.email = body.email;
  if (body.password != null) {
    data.password = body.password;
    data.accessToken = null;
    data.tokenExpiresAt = null;
  }
  if (body.apiKey !== undefined) {
    data.apiKey = body.apiKey;
    data.accessToken = null;
    data.tokenExpiresAt = null;
  }
  if (body.hidden !== undefined) data.hidden = body.hidden;
  const item = await prisma.siteAccount.update({
    where: { id: numId },
    data,
  });
  return NextResponse.json({ item });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const numId = Number(id);
  await prisma.siteAccount.delete({ where: { id: numId } });
  return NextResponse.json({ ok: true });
}
