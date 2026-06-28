import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// Lightweight site listing for the scheduling page's site picker.
// Filters to sub2api types since /admin/ops/concurrency only exists there.
export async function GET() {
  const [sites, settings] = await Promise.all([
    prisma.siteAccount.findMany({
      where: { type: "sub2api", hidden: false },
      orderBy: { id: "asc" },
      select: { id: true, name: true, type: true },
    }),
    prisma.settings.findUnique({ where: { id: 1 }, select: { schedulingDefaultSiteId: true } }),
  ]);
  return NextResponse.json({
    items: sites,
    defaultSiteId: settings?.schedulingDefaultSiteId ?? null,
  });
}
