import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getDashboardSummary } from "@/lib/dashboard";
import { maybeSendDiffAlert } from "@/lib/mailer";

export const runtime = "nodejs";

// Force-trigger an alert email regardless of threshold/cooldown.
// Useful for "立刻通知" button.
export async function POST() {
  try {
    // Reset cooldown so maybeSendDiffAlert always sends.
    await prisma.settings.update({
      where: { id: 1 },
      data: { emailLastSentAt: null },
    });
    const s = await getDashboardSummary();
    // override threshold check by faking diffOverThreshold via wrapper
    const r = await maybeSendDiffAlert({
      ...s,
      diffOverThreshold: true,
    });
    if (!r.sent) {
      return NextResponse.json({ ok: false, reason: r.reason }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
