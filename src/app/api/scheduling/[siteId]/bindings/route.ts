import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// Returns: { byRemoteAccountId: Record<string, { maxConcurrency, upstreamKey }[]> }
// — for each siteBoundAccount.remoteAccountId on this site, list its bindings
// so the scheduling page can show "绑 max N" chips per account row.
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ siteId: string }> },
) {
  const { siteId } = await ctx.params;
  const id = Number(siteId);
  const accounts = await prisma.siteBoundAccount.findMany({
    where: { siteAccountId: id },
    include: {
      bindings: {
        include: {
          upstreamKey: { include: { upstreamAccount: true } },
        },
      },
    },
  });
  const byRemoteAccountId: Record<
    string,
    Array<{
      bindingId: number;
      maxConcurrency: number | null;
      upstreamKeyName: string;
      upstreamAccountName: string;
      upstreamGroupName: string;
      // Group default × multiplier (display reference).
      upstreamGroupRateMultiplier: number;
      // The rate actually applied to this user; equals group default unless
      // an exclusive override exists.
      upstreamEffectiveRateMultiplier: number;
      upstreamHasExclusiveRate: boolean;
    }>
  > = {};
  for (const a of accounts) {
    byRemoteAccountId[String(a.remoteAccountId)] = a.bindings.map((b) => ({
      bindingId: b.id,
      maxConcurrency: b.maxConcurrency,
      upstreamKeyName: b.upstreamKey.name,
      upstreamAccountName: b.upstreamKey.upstreamAccount.name,
      upstreamGroupName: b.upstreamKey.groupName,
      upstreamGroupRateMultiplier: b.upstreamKey.groupRateMultiplier,
      upstreamEffectiveRateMultiplier: b.upstreamKey.effectiveRateMultiplier,
      upstreamHasExclusiveRate: b.upstreamKey.hasExclusiveRate,
    }));
  }
  return NextResponse.json({ byRemoteAccountId });
}
