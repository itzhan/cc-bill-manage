import { NextResponse } from "next/server";
import { makeSiteClient, runWithLimit } from "@/lib/az-server";

export const runtime = "nodejs";
export const maxDuration = 60;

// Returns today's per-user breakdown for every group on the site.
// One HTTP call to sub2api per group (cheap — server-side aggregation).
// Cap concurrency at 10. Refreshed every ~60s on the client.
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ siteId: string }> },
) {
  const { siteId } = await ctx.params;
  const id = Number(siteId);
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  try {
    const client = await makeSiteClient(id);
    const groups = await client.listAdminGroupsAll();
    type Row = {
      group_id: number;
      group_name: string;
      users: Array<{
        user_id: number;
        email?: string;
        requests: number;
        cost: number;
        actual_cost: number;
      }>;
      error?: string;
    };
    const rows = await runWithLimit<typeof groups[number], Row>(
      groups,
      10,
      async (g) => {
        try {
          const r = await client.getGroupUserBreakdown(g.id, today, today);
          return {
            group_id: g.id,
            group_name: g.name,
            users: (r.users ?? []).map((u) => ({
              user_id: u.user_id,
              email: u.email,
              requests: u.requests,
              cost: u.cost,
              actual_cost: u.actual_cost,
            })),
          };
        } catch (e) {
          return {
            group_id: g.id,
            group_name: g.name,
            users: [],
            error: e instanceof Error ? e.message.slice(0, 200) : String(e),
          };
        }
      },
    );
    return NextResponse.json({ today, groups: rows });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
