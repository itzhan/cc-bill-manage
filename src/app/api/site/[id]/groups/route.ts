import { NextResponse } from "next/server";
import { makeSiteClient } from "@/lib/az-server";

export const runtime = "nodejs";

// 列出 sub2api 站点上的所有 admin 分组 — 给"→ 本站"弹窗里挑分组用。
// 只对 sub2api 类型有效, makeSiteClient 已经把 type 不对的拒了。
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const siteId = Number(id);
  if (!Number.isFinite(siteId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  try {
    const client = await makeSiteClient(siteId);
    const groups = await client.listAdminGroupsAll();
    return NextResponse.json({
      items: groups.map((g) => ({
        id: g.id,
        name: g.name,
        rate_multiplier: g.rate_multiplier,
        platform: g.platform,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
