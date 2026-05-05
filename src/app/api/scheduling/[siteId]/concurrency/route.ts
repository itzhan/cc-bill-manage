import { NextResponse } from "next/server";
import { makeSiteClient } from "@/lib/az-server";

export const runtime = "nodejs";

// Real-time in-flight counts. Designed to be polled at 2s.
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ siteId: string }> },
) {
  const { siteId } = await ctx.params;
  const id = Number(siteId);
  try {
    const client = await makeSiteClient(id);
    const data = await client.getOpsConcurrency();
    return NextResponse.json({ siteId: id, ...data });
  } catch (e) {
    return NextResponse.json(
      { siteId: id, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
