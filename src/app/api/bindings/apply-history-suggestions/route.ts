import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { recomputeAllDailyProfits } from "@/lib/history";

export const runtime = "nodejs";

// body: { items: [{ siteBoundAccountId, orphanUpstreamKeyId, latestDate }] }
//
// 对每条建议: 创建一条历史 binding (createdAt=epoch, endedAt=latestDate 当天 23:59:59),
// 让历史日期的 paired view 把孤立 upstream key 的支出归属到目标 site 账号。
// 整批包在一个事务里。
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Partial<{
    items: Array<{
      siteBoundAccountId: number;
      orphanUpstreamKeyId: number;
      latestDate: string;
    }>;
  }>;
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) {
    return NextResponse.json({ created: 0 });
  }
  const ops = items
    .filter(
      (x) =>
        Number.isFinite(x.siteBoundAccountId) &&
        Number.isFinite(x.orphanUpstreamKeyId) &&
        /^\d{4}-\d{2}-\d{2}$/.test(x.latestDate),
    )
    .map((x) =>
      prisma.binding.create({
        data: {
          siteBoundAccountId: x.siteBoundAccountId,
          upstreamKeyId: x.orphanUpstreamKeyId,
          // 远古 createdAt 让它覆盖该 endedAt 之前所有日期
          createdAt: new Date("2000-01-01T00:00:00Z"),
          endedAt: new Date(`${x.latestDate}T23:59:59+08:00`),
        },
      }),
    );
  try {
    const created = await prisma.$transaction(ops);
    // 新增的历史 binding 会影响过去任意日期的 paired 计算; 全量重算 DailyProfit
    // 保证 UI 表格立即反映。
    const { updated } = await recomputeAllDailyProfits();
    return NextResponse.json({ created: created.length, recomputed: updated });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
