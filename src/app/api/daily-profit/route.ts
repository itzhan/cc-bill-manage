import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// GET /api/daily-profit?days=30  → last N days, newest first
export async function GET(req: Request) {
  const url = new URL(req.url);
  const days = Math.min(
    365,
    Math.max(1, Number(url.searchParams.get("days")) || 30),
  );
  const items = await prisma.dailyProfit.findMany({
    orderBy: { date: "desc" },
    take: days,
  });
  // Recompute diff from stored bases so historical rows reflect the new
  // "loss only" rule: max(0, upstream − site). Old rows had Math.abs.
  const normalized = items.map((d) => ({
    ...d,
    diff: Math.max(0, d.upstreamCostBase - d.siteCostBase),
  }));
  return NextResponse.json({ items: normalized });
}
