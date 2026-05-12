import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { startTruncProbeInBackground } from "@/lib/bench";

export const runtime = "nodejs";

// Manually trigger / re-trigger the long-thinking truncation probe for an
// existing run. Used when the run was created without the opt-in checkbox.
// Safe to call repeatedly: flips status to pending and lets the background
// runner pick it up (single-flight via the truncRunning set in bench.ts).
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const run = await prisma.benchRun.findUnique({ where: { id: Number(id) } });
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (run.truncProbeStatus === "running") {
    return NextResponse.json({ ok: true, already: "running" });
  }
  await prisma.benchRun.update({
    where: { id: run.id },
    data: {
      truncProbeStatus: "pending",
      truncProbeError: null,
      truncProbeVerdict: null,
    },
  });
  startTruncProbeInBackground(run.id);
  return NextResponse.json({ ok: true });
}
