import { NextResponse } from "next/server";
import { makeSiteClient } from "@/lib/az-server";

export const runtime = "nodejs";

// Returns groups + admin accounts with their concurrency limits, priorities,
// statuses, and group memberships. Used for the scheduling page's structural
// view; refreshed every ~60s on the client (not every 2s).
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ siteId: string }> },
) {
  const { siteId } = await ctx.params;
  const id = Number(siteId);
  try {
    const client = await makeSiteClient(id);
    const [groups, accounts] = await Promise.all([
      client.listAdminGroupsAll(),
      client.listAdminAccountsFiltered({ page_size: 1000 }),
    ]);
    return NextResponse.json({
      siteId: id,
      groups,
      accounts: accounts.items,
    });
  } catch (e) {
    return NextResponse.json(
      { siteId: id, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
