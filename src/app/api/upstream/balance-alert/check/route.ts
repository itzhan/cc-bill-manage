import { NextResponse } from "next/server";
import { checkBalanceAlerts } from "@/lib/balance-alert";

export const runtime = "nodejs";

// 手动触发一次余额检测(忽略 intervalMin 节流是不行的——节流仍生效;
// 想立刻发,把 intervalMin 改成 0 或等下一轮)。返回简单 ok。
export async function POST() {
  try {
    await checkBalanceAlerts();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
