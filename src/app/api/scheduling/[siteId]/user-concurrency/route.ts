import { NextResponse } from "next/server";
import { makeSiteClient } from "@/lib/az-server";

export const runtime = "nodejs";

// Per-user real-time concurrency. Used by the scheduling page to render
// the "top 5 users by in-flight requests" mini panel.
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ siteId: string }> },
) {
  const { siteId } = await ctx.params;
  const id = Number(siteId);
  try {
    const client = await makeSiteClient(id);
    const data = await client.getUserConcurrency();
    return NextResponse.json({
      siteId: id,
      enabled: data.enabled !== false,
      user: data.user ?? {},
      timestamp: data.timestamp ?? null,
    });
  } catch (e) {
    return NextResponse.json(
      { siteId: id, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
