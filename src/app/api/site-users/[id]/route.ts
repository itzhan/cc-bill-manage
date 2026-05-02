import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as Partial<{
    rateMultiplierOverride: number | null;
    alias: string | null;
    notes: string | null;
  }>;
  const data: Record<string, unknown> = {};
  if ("rateMultiplierOverride" in body) {
    data.rateMultiplierOverride =
      body.rateMultiplierOverride == null ||
      Number.isNaN(Number(body.rateMultiplierOverride))
        ? null
        : Number(body.rateMultiplierOverride);
  }
  if ("alias" in body) {
    data.alias =
      body.alias == null || body.alias === "" ? null : String(body.alias);
  }
  if ("notes" in body) data.notes = body.notes;
  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: "no editable fields supplied" },
      { status: 400 },
    );
  }
  const item = await prisma.siteUser.update({
    where: { id: Number(id) },
    data,
  });
  return NextResponse.json({ item });
}
