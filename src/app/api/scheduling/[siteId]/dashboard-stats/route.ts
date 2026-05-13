import { NextResponse } from "next/server";
import { makeSiteClient } from "@/lib/az-server";

export const runtime = "nodejs";

// Site-level RPM/TPM, polled by the scheduling page. Returns only the two
// numbers we need; the upstream payload also contains user/account/token
// totals which the scheduling page doesn't care about.
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ siteId: string }> },
) {
  const { siteId } = await ctx.params;
  const id = Number(siteId);
  try {
    const client = await makeSiteClient(id);
    const stats = await client.getDashboardStats();
    return NextResponse.json({
      siteId: id,
      rpm: typeof stats.rpm === "number" ? stats.rpm : 0,
      tpm: typeof stats.tpm === "number" ? stats.tpm : 0,
    });
  } catch (e) {
    return NextResponse.json(
      { siteId: id, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
