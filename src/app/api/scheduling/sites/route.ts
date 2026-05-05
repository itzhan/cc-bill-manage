import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// Lightweight site listing for the scheduling page's site picker.
// Filters to sub2api types since /admin/ops/concurrency only exists there.
export async function GET() {
  const sites = await prisma.siteAccount.findMany({
    where: { type: "sub2api" },
    orderBy: { id: "asc" },
    select: { id: true, name: true, type: true },
  });
  return NextResponse.json({ items: sites });
}
