import { NextResponse } from "next/server";
import { makeSiteClient, runWithLimit } from "@/lib/az-server";

export const runtime = "nodejs";
export const maxDuration = 60;

// Returns today's per-group usage so the scheduling page can sort
// groups by consumption desc. Fans out per group_id to sub2api's
// /admin/usage/stats — concurrency capped at 10. Refreshed every ~60s
// from the client.
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
    const rows = await runWithLimit<
      typeof groups[number],
      { id: number; cost: number; actualCost: number; requests: number; error?: string }
    >(groups, 10, async (g) => {
      try {
        const s = await client.getGroupUsageStatsToday(g.id, today);
        return {
          id: g.id,
          cost: s.total_cost ?? 0,
          actualCost: s.total_actual_cost ?? 0,
          requests: s.total_requests ?? 0,
        };
      } catch (e) {
        return {
          id: g.id,
          cost: 0,
          actualCost: 0,
          requests: 0,
          error: e instanceof Error ? e.message.slice(0, 200) : String(e),
        };
      }
    });
    const byGroup: Record<
      string,
      { cost: number; actualCost: number; requests: number }
    > = {};
    for (const r of rows) {
      byGroup[String(r.id)] = {
        cost: r.cost,
        actualCost: r.actualCost,
        requests: r.requests,
      };
    }
    return NextResponse.json({ today, byGroup });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
