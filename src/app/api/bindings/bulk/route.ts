import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// Create the Cartesian product of N site accounts × M upstream keys in
// one shot. Existing pairs are skipped (idempotent). Backwards compatible:
// `upstreamKeyId` (singular) still works.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Partial<{
    siteBoundAccountIds: number[];
    upstreamKeyId: number;
    upstreamKeyIds: number[];
    maxConcurrency: number | null;
  }>;
  const siteIds = (body.siteBoundAccountIds ?? []).map(Number).filter(Boolean);
  const keyIds = [
    ...(body.upstreamKeyIds ?? []),
    ...(body.upstreamKeyId != null ? [body.upstreamKeyId] : []),
  ]
    .map(Number)
    .filter(Boolean);
  const maxConcurrency =
    typeof body.maxConcurrency === "number" && body.maxConcurrency > 0
      ? Math.floor(body.maxConcurrency)
      : null;
  if (siteIds.length === 0 || keyIds.length === 0) {
    return NextResponse.json(
      {
        error:
          "siteBoundAccountIds and upstreamKeyIds (or upstreamKeyId) required",
      },
      { status: 400 },
    );
  }
  let created = 0;
  let skipped = 0;
  const errors: {
    siteBoundAccountId: number;
    upstreamKeyId: number;
    error: string;
  }[] = [];
  for (const sid of siteIds) {
    for (const kid of keyIds) {
      try {
        await prisma.binding.create({
          data: {
            siteBoundAccountId: sid,
            upstreamKeyId: kid,
            maxConcurrency,
          },
        });
        created++;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("Unique constraint")) {
          skipped++;
        } else {
          errors.push({
            siteBoundAccountId: sid,
            upstreamKeyId: kid,
            error: msg.slice(0, 200),
          });
        }
      }
    }
  }
  return NextResponse.json({ created, skipped, errors });
}
