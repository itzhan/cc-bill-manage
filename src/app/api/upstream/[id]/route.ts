import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const numId = Number(id);
  const item = await prisma.upstreamAccount.findUnique({
    where: { id: numId },
    include: { keys: { orderBy: { id: "asc" } } },
  });
  if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ item });
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
  }>;
  const data: Record<string, unknown> = {};
  if (body.name != null) data.name = body.name;
  if (body.baseUrl != null) data.baseUrl = body.baseUrl;
  if (body.email != null) data.email = body.email;
  if (body.password != null) {
    data.password = body.password;
    // password changed -> invalidate token
    data.accessToken = null;
    data.tokenExpiresAt = null;
  }
  const item = await prisma.upstreamAccount.update({
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
  await prisma.upstreamAccount.delete({ where: { id: numId } });
  return NextResponse.json({ ok: true });
}
