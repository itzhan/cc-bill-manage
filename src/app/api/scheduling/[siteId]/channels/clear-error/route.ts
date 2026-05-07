import { NextResponse } from "next/server";
import { makeSiteClient } from "@/lib/az-server";

export const runtime = "nodejs";

// Clear error_message on one or more sub2api admin accounts. Used by the
// smart-dispatch flow after a passing test, so revived channels don't
// stay flagged with stale errors.
export async function POST(
  req: Request,
  ctx: { params: Promise<{ siteId: string }> },
) {
  const { siteId } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as {
    account_ids?: number[];
  };
  const ids = (body.account_ids || []).filter((n) => Number.isFinite(n));
  if (ids.length === 0) {
    return NextResponse.json({ error: "account_ids required" }, { status: 400 });
  }
  try {
    const client = await makeSiteClient(Number(siteId));
    const out = await client.clearAdminAccountsError(ids);
    return NextResponse.json({ ok: true, result: out });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
