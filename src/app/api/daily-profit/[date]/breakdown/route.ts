import { NextResponse } from "next/server";
import { fetchDateBreakdown } from "@/lib/history";

export const runtime = "nodejs";
export const maxDuration = 120;

// GET /api/daily-profit/2026-05-04/breakdown[?refresh=1]
//
// 默认从本地 DailyProfitBreakdown 表读（不打上游），适用于反复点开看历史。
// 带 ?refresh=1 强制重新从上游拉取并 write-through 到 DB——用于初次回填
// 或怀疑数据有误时主动刷新。
export async function GET(
  req: Request,
  ctx: { params: Promise<{ date: string }> },
) {
  const { date } = await ctx.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: "date 必须是 YYYY-MM-DD" },
      { status: 400 },
    );
  }
  const url = new URL(req.url);
  const forceRefresh = url.searchParams.get("refresh") === "1";
  try {
    const result = await fetchDateBreakdown(date, { forceRefresh });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
