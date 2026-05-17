import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { makeSiteClient } from "@/lib/az-server";
import { refreshSiteAccount } from "@/lib/sync";

export const runtime = "nodejs";

// 把一条 upstream key 一键铺到 site:
// 1) 在目标 SiteAccount 上 createAdminAccount(用 key.apiKey + upstream.baseUrl)
// 2) refreshSiteAccount 把新账号拉回 SiteBoundAccount 表
// 3) 找到刚创建的 SiteBoundAccount, 建一条 binding (siteBoundAccountId → upstreamKeyId)
//
// 现状: 需要 upstream key 有 apiKey (raw) — sub2api 老版本只回 mask, 这时
// 此操作不可行, 返回 400 让 UI 提示用户。
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const keyId = Number(id);
  if (!Number.isFinite(keyId)) {
    return NextResponse.json({ error: "invalid key id" }, { status: 400 });
  }
  const body = (await req.json().catch(() => ({}))) as Partial<{
    siteAccountId: number;
    name: string;
    groupIds: number[];
    concurrency: number;
    rateMultiplier: number;
    platform: string;
    type: string;
  }>;
  const {
    siteAccountId,
    name,
    groupIds,
    concurrency,
    rateMultiplier,
    platform = "anthropic",
    type = "apikey",
  } = body;
  if (
    !siteAccountId ||
    !name ||
    !Array.isArray(groupIds) ||
    groupIds.length === 0 ||
    !concurrency ||
    !rateMultiplier
  ) {
    return NextResponse.json(
      { error: "siteAccountId/name/groupIds/concurrency/rateMultiplier 必填" },
      { status: 400 },
    );
  }

  const key = await prisma.upstreamKey.findUnique({
    where: { id: keyId },
    include: { upstreamAccount: true },
  });
  if (!key) {
    return NextResponse.json({ error: "upstream key 不存在" }, { status: 404 });
  }
  if (!key.apiKey) {
    return NextResponse.json(
      {
        error:
          "此 upstream key 没有保存原始 apiKey (上游可能只回了 mask)。请去上游手动获取再粘贴, 或试试'完整刷新'。",
      },
      { status: 400 },
    );
  }

  const site = await prisma.siteAccount.findUnique({
    where: { id: Number(siteAccountId) },
  });
  if (!site) {
    return NextResponse.json({ error: "目标 site 不存在" }, { status: 404 });
  }
  if (site.type !== "sub2api") {
    return NextResponse.json(
      { error: "目前只支持 sub2api 站点" },
      { status: 400 },
    );
  }

  try {
    const client = await makeSiteClient(Number(siteAccountId));
    const created = await client.createAdminAccount({
      name,
      platform,
      type,
      credentials: {
        base_url: key.upstreamAccount.baseUrl,
        api_key: key.apiKey,
      },
      concurrency,
      priority: 50,
      rate_multiplier: rateMultiplier,
      group_ids: groupIds,
      // 混渠道风险确认 — az 工具走的也是这条, 默认 true 否则上游会卡校验
      confirm_mixed_channel_risk: true,
    });

    // 拉一次让新账号进 SiteBoundAccount 表 — 然后才能拿来建 binding
    await refreshSiteAccount(Number(siteAccountId)).catch((e) => {
      console.error("[push-to-site] refresh after create failed:", e);
    });

    const newBound = await prisma.siteBoundAccount.findUnique({
      where: {
        siteAccountId_remoteAccountId: {
          siteAccountId: Number(siteAccountId),
          remoteAccountId: created.id,
        },
      },
    });
    if (!newBound) {
      return NextResponse.json(
        {
          error:
            "账号已建但同步未拉到, 请稍后手动同步;binding 未建立",
          remoteAccountId: created.id,
        },
        { status: 207 },
      );
    }

    await prisma.binding.create({
      data: {
        siteBoundAccountId: newBound.id,
        upstreamKeyId: keyId,
      },
    });

    return NextResponse.json({
      ok: true,
      remoteAccountId: created.id,
      siteBoundAccountId: newBound.id,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
