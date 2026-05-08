import { NextResponse } from "next/server";
import { makeSiteClient } from "@/lib/az-server";

export const runtime = "nodejs";

// GET: list models currently allowed on this channel.
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ siteId: string; id: string }> },
) {
  const { siteId, id } = await ctx.params;
  try {
    const client = await makeSiteClient(Number(siteId));
    const items = await client.getAccountModels(Number(id));
    return NextResponse.json({
      items: items.map((m) => ({
        id: m.id,
        displayName: m.display_name ?? m.id,
        type: m.type ?? "",
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

// PUT: replace the model whitelist.
// sub2api stores models as `credentials.model_mapping = { from: to }`. We
// fetch the full account first so we don't accidentally clobber other
// credential fields (api_key / base_url) when we PUT the new credentials
// block back.
export async function PUT(
  req: Request,
  ctx: { params: Promise<{ siteId: string; id: string }> },
) {
  const { siteId, id } = await ctx.params;
  const accountId = Number(id);
  const body = (await req.json().catch(() => ({}))) as Partial<{
    models: string[];
  }>;
  const models = Array.isArray(body.models)
    ? body.models
        .map((s) => String(s).trim())
        .filter((s) => s.length > 0)
    : null;
  if (models == null) {
    return NextResponse.json({ error: "models array required" }, { status: 400 });
  }
  try {
    const client = await makeSiteClient(Number(siteId));
    const acc = await client.getAdminAccount(accountId);
    const creds = (acc.credentials ?? {}) as Record<string, unknown>;
    if (models.length === 0) {
      // Empty whitelist = clear it (sub2api convention: no model_mapping = allow all).
      delete creds.model_mapping;
    } else {
      // Identity mapping — UI doesn't expose alias-style remapping today.
      creds.model_mapping = Object.fromEntries(models.map((m) => [m, m]));
    }
    await client.updateAdminAccount(accountId, { credentials: creds });
    return NextResponse.json({ ok: true, models });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
