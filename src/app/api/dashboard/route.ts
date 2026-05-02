import { NextResponse } from "next/server";
import { getDashboardSummary } from "@/lib/dashboard";
import { ensureScheduler } from "@/lib/scheduler";

export const runtime = "nodejs";

export async function GET() {
  await ensureScheduler();
  const summary = await getDashboardSummary();
  return NextResponse.json(summary);
}
