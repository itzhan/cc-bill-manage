import { NextResponse } from "next/server";
import { makeSiteClient } from "@/lib/az-server";

export const runtime = "nodejs";

// GET full account incl. credentials. The list endpoint omits credentials
// for size; the edit modal needs base_url + api_key for the copy buttons.
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ siteId: string; id: string }> },
) {
  const { siteId, id } = await ctx.params;
  try {
    const client = await makeSiteClient(Number(siteId));
    const acc = await client.getAdminAccount(Number(id));
    const creds = (acc.credentials ?? {}) as Record<string, unknown>;
    const baseUrl = typeof creds.base_url === "string" ? creds.base_url : "";
    const apiKey = typeof creds.api_key === "string" ? creds.api_key : "";
    return NextResponse.json({
      item: {
        id: acc.id,
        name: acc.name,
        status: acc.status,
        baseUrl,
        apiKey,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}

// Update one channel: status, concurrency, priority, group_ids, etc.
export async function PUT(
  req: Request,
  ctx: { params: Promise<{ siteId: string; id: string }> },
) {
  const { siteId, id } = await ctx.params;
  const sId = Number(siteId);
  const accId = Number(id);
  const body = await req.json().catch(() => ({}));
  try {
    const client = await makeSiteClient(sId);
    const out = await client.updateAdminAccount(accId, body);
    return NextResponse.json({ item: out });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
