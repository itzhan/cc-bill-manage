import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const range = searchParams.get("range") || "24h";
  const now = Date.now();
  const ranges: Record<string, number> = {
    "1h": 60 * 60 * 1000,
    "6h": 6 * 60 * 60 * 1000,
    "24h": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
  };
  const span = ranges[range] ?? ranges["24h"];
  const since = new Date(now - span);

  const points = await prisma.snapshot.findMany({
    where: { takenAt: { gte: since } },
    orderBy: { takenAt: "asc" },
    select: {
      takenAt: true,
      totalRevenue: true,
      totalExpense: true,
      totalProfit: true,
    },
  });

  return NextResponse.json({
    points: points.map((p) => ({
      t: p.takenAt.toISOString(),
      revenue: p.totalRevenue,
      expense: p.totalExpense,
      profit: p.totalProfit,
    })),
  });
}
