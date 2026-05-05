import { NextResponse } from "next/server";
import { makeSiteClient } from "@/lib/az-server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  req: Request,
  ctx: { params: Promise<{ siteId: string; id: string }> },
) {
  const { siteId, id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as {
    model_id?: string;
    prompt?: string;
    mode?: string;
  };
  try {
    const client = await makeSiteClient(Number(siteId));
    const result = await client.testAdminAccount(Number(id), body);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { ok: false, output: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
