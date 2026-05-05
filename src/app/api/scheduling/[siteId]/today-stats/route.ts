import { NextResponse } from "next/server";
import { makeSiteClient } from "@/lib/az-server";

export const runtime = "nodejs";

// Per-account today stats — single batch call to sub2api's
// /admin/accounts/today-stats/batch. Polled every 2 min on the client.
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ siteId: string }> },
) {
  const { siteId } = await ctx.params;
  const id = Number(siteId);
  try {
    const client = await makeSiteClient(id);
    const list = await client.listAdminAccountsFiltered({ page_size: 1000 });
    const ids = list.items.map((a) => a.id);
    const stats = await client.getAccountsStats(ids);
    return NextResponse.json({ stats });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
