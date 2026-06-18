import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// 公开端点 — 无登录, 中间件已放行 /api/public/*。
// 仅返回"配置 + 允许展示的用户/分组的静态元数据", 实时数据走 /stats。
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ shareId: string }> },
) {
  const { shareId } = await ctx.params;
  const share = await prisma.publicShare.findUnique({
    where: { shareId },
    include: {
      siteAccount: { select: { id: true, name: true } },
    },
  });
  if (!share) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const userIds: number[] = JSON.parse(share.userIdsJson || "[]");
  const groupIds: number[] = JSON.parse(share.groupIdsJson || "[]");

  // 把允许的用户对应的 SiteUser 元数据带回 (用 alias > username > email)。
  const users = userIds.length
    ? await prisma.siteUser.findMany({
        where: {
          siteAccountId: share.siteAccountId,
          remoteUserId: { in: userIds },
        },
        select: {
          remoteUserId: true,
          email: true,
          username: true,
          alias: true,
        },
      })
    : [];
  const userMeta = users.map((u) => ({
    id: u.remoteUserId,
    name: u.alias || u.username || u.email,
  }));

  return NextResponse.json({
    shareId: share.shareId,
    name: share.name,
    siteName: share.siteAccount.name,
    allowedUserIds: userIds,
    allowedGroupIds: groupIds,
    users: userMeta,
  });
}
