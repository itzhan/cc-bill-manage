import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { makeSiteClient } from "@/lib/az-server";

export const runtime = "nodejs";

// 公开实时数据 — 客户页面轮询这条。
// 返回:
//   site:   rpm / tpm  (整站级别, dashboard-stats)
//   users:  每个允许用户的 in-flight 并发 + 累计今日/总消费 (SiteUser 表)
//   rpm:    每个允许用户的 per-group RPM (过滤到允许的 groupIds)
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ shareId: string }> },
) {
  const { shareId } = await ctx.params;
  const share = await prisma.publicShare.findUnique({ where: { shareId } });
  if (!share) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const userIds: number[] = JSON.parse(share.userIdsJson || "[]");
  const groupIds: number[] = JSON.parse(share.groupIdsJson || "[]");
  const allowedGroupSet = new Set<number>(groupIds);

  // 并发拉所有上游 + 本地 SiteUser 元数据。任何一项失败软降, 不阻塞其他。
  const client = await makeSiteClient(share.siteAccountId).catch(() => null);
  if (!client) {
    return NextResponse.json({ error: "site client unavailable" }, { status: 500 });
  }

  const [dashStats, userConc, rpmList, siteUsers] = await Promise.all([
    client.getDashboardStats().catch(() => null),
    client.getUserConcurrency().catch(() => null),
    userIds.length
      ? Promise.all(
          userIds.map((uid) =>
            client
              .getUserRpmStatus(uid)
              .then((r) => [uid, r] as const)
              .catch(() => [uid, null] as const),
          ),
        )
      : Promise.resolve([] as Array<readonly [number, unknown]>),
    userIds.length
      ? prisma.siteUser.findMany({
          where: {
            siteAccountId: share.siteAccountId,
            remoteUserId: { in: userIds },
          },
          select: {
            remoteUserId: true,
            email: true,
            username: true,
            alias: true,
            balance: true,
            totalRecharged: true,
            todayActualCost: true,
            todayCost: true,
            rateMultiplierOverride: true,
          },
        })
      : Promise.resolve([]),
  ]);

  // user-concurrency 是 keyed by user_id 的 map; 过滤到允许的 userIds。
  const concMap: Record<string, unknown> = {};
  if (userConc?.user) {
    for (const uid of userIds) {
      const row = userConc.user[String(uid)];
      if (row) concMap[String(uid)] = row;
    }
  }

  // per-user rpm-status, per_group 再用 allowedGroupSet 过滤。
  const rpmMap: Record<string, {
    user_rpm_used?: number;
    user_rpm_limit?: number;
    per_group: Array<{
      group_id: number;
      group_name?: string;
      used: number;
      limit?: number;
    }>;
  }> = {};
  for (const [uid, r] of rpmList) {
    if (!r || typeof r !== "object") continue;
    const status = r as {
      user_rpm_used?: number;
      user_rpm_limit?: number;
      per_group?: Array<{
        group_id: number;
        group_name?: string;
        used: number;
        limit?: number;
      }>;
    };
    const perGroup = (status.per_group ?? []).filter(
      (g) => allowedGroupSet.size === 0 || allowedGroupSet.has(g.group_id),
    );
    rpmMap[String(uid)] = {
      user_rpm_used: status.user_rpm_used,
      user_rpm_limit: status.user_rpm_limit,
      per_group: perGroup,
    };
  }

  // SiteUser 元数据 + 账务汇总。
  const users = siteUsers.map((u) => {
    const consumed = Math.max(0, u.totalRecharged - u.balance);
    const eff = u.rateMultiplierOverride ?? 1;
    return {
      id: u.remoteUserId,
      name: u.alias || u.username || u.email,
      balance: u.balance,
      totalRecharged: u.totalRecharged,
      todayActualCost: u.todayActualCost,
      todayCost: u.todayCost,
      effectiveConsumed: consumed * eff,
    };
  });

  return NextResponse.json({
    site: {
      rpm: typeof dashStats?.rpm === "number" ? dashStats.rpm : 0,
      tpm: typeof dashStats?.tpm === "number" ? dashStats.tpm : 0,
    },
    users,
    userConcurrency: concMap,
    userRpm: rpmMap,
  });
}
