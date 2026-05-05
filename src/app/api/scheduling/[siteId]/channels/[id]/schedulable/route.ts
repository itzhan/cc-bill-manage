import { NextResponse } from "next/server";
import { makeSiteClient } from "@/lib/az-server";

export const runtime = "nodejs";

// Flip the dedicated "participate in dispatch" toggle on a sub2api admin
// account. Distinct from status — when false, dispatcher excludes this
// account regardless of status=active.
export async function POST(
  req: Request,
  ctx: { params: Promise<{ siteId: string; id: string }> },
) {
  const { siteId, id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as {
    schedulable?: boolean;
  };
  if (typeof body.schedulable !== "boolean") {
    return NextResponse.json(
      { error: "schedulable (boolean) required" },
      { status: 400 },
    );
  }
  try {
    const client = await makeSiteClient(Number(siteId));
    await client.setAccountSchedulable(Number(id), body.schedulable);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
