import { NextResponse } from "next/server";
import { makeSiteClient } from "@/lib/az-server";

export const runtime = "nodejs";

// Update one channel: status, concurrency, priority, group_ids, etc.
export async function PUT(
  req: Request,
  ctx: { params: Promise<{ siteId: string; id: string }> },
) {
  const { siteId, id } = await ctx.params;
  const sId = Number(siteId);
  const accId = Number(id);
  const body = await req.json().catch(() => ({}));
  try {
    const client = await makeSiteClient(sId);
    const out = await client.updateAdminAccount(accId, body);
    return NextResponse.json({ item: out });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
