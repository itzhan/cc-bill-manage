import { NextResponse } from "next/server";
import { makeSiteClient } from "@/lib/az-server";

export const runtime = "nodejs";
// 单请求改 N 个账号, 给一点裕量。
export const maxDuration = 60;

// POST /api/scheduling/[siteId]/channels/bulk-update
// body: {
//   accountIds: number[],
//   patch: { status?, concurrency?, priority?, schedulable?, rateMultiplier?,
//            loadFactor?, name?, groupIds?, ... }
// }
//
// 直接调 sub2api 的 /api/v1/admin/accounts/bulk-update — 一次 HTTP 改多个,
// 替代过去 N 次串/并发 PUT, 避免前端卡顿。
export async function POST(
  req: Request,
  ctx: { params: Promise<{ siteId: string }> },
) {
  const { siteId } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as {
    accountIds?: number[];
    patch?: Record<string, unknown>;
  };
  const ids = (body.accountIds ?? [])
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n) && n > 0);
  const patch = body.patch ?? {};
  if (ids.length === 0) {
    return NextResponse.json(
      { error: "accountIds required" },
      { status: 400 },
    );
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: "patch required (no fields to update)" },
      { status: 400 },
    );
  }
  // Camel → snake (sub2api 用 snake_case)。只搬已知字段, 防止误传。
  const upstreamPatch: Record<string, unknown> = {};
  if (patch.name !== undefined) upstreamPatch.name = patch.name;
  if (patch.status !== undefined) upstreamPatch.status = patch.status;
  if (patch.concurrency !== undefined)
    upstreamPatch.concurrency = patch.concurrency;
  if (patch.priority !== undefined) upstreamPatch.priority = patch.priority;
  if (patch.schedulable !== undefined)
    upstreamPatch.schedulable = patch.schedulable;
  if (patch.rateMultiplier !== undefined)
    upstreamPatch.rate_multiplier = patch.rateMultiplier;
  if (patch.loadFactor !== undefined)
    upstreamPatch.load_factor = patch.loadFactor;
  if (patch.proxyId !== undefined) upstreamPatch.proxy_id = patch.proxyId;
  if (patch.groupIds !== undefined) upstreamPatch.group_ids = patch.groupIds;
  if (patch.confirmMixedChannelRisk !== undefined)
    upstreamPatch.confirm_mixed_channel_risk = patch.confirmMixedChannelRisk;

  try {
    const client = await makeSiteClient(Number(siteId));
    const out = await client.bulkUpdateAdminAccounts({
      account_ids: ids,
      ...upstreamPatch,
    });
    return NextResponse.json({ ok: true, result: out });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
