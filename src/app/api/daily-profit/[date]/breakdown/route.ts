import { NextResponse } from "next/server";
import { fetchDateBreakdown } from "@/lib/history";

export const runtime = "nodejs";
export const maxDuration = 120;

// GET /api/daily-profit/2026-05-04/breakdown
//
// 实时拉某一天的逐 key 数据（不写 DB），用于"点击日期看明细"。
// 跟回填用同一套抓取路径（upKeyMap + siteAccMap），所以结果跟那天最近一次
// backfill 应该一致；如果你刚改了倍率，breakdown 会反映新倍率，DB 行还是
// 旧的，直到下次 backfill。
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ date: string }> },
) {
  const { date } = await ctx.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: "date 必须是 YYYY-MM-DD" },
      { status: 400 },
    );
  }
  try {
    const result = await fetchDateBreakdown(date);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
