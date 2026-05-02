import { NextResponse } from "next/server";
import { sendTestEmail } from "@/lib/mailer";

export const runtime = "nodejs";

export async function POST() {
  try {
    await sendTestEmail();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
