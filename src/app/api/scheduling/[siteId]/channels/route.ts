import { NextResponse } from "next/server";
import { makeSiteClient } from "@/lib/az-server";

export const runtime = "nodejs";

// Create a new admin account (= channel) on the site's sub2api.
export async function POST(
  req: Request,
  ctx: { params: Promise<{ siteId: string }> },
) {
  const { siteId } = await ctx.params;
  const id = Number(siteId);
  const body = await req.json().catch(() => ({}));
  try {
    const client = await makeSiteClient(id);
    const created = await client.createAdminAccount(body);
    return NextResponse.json({ item: created });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
