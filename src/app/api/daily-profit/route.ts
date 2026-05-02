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
  return NextResponse.json({ items });
}
