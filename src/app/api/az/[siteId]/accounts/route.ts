import { NextResponse } from "next/server";
import { makeSiteClient } from "@/lib/az-server";
import { prisma } from "@/lib/db";
import { readConfig } from "@/lib/az";

export const runtime = "nodejs";

// GET /api/az/[siteId]/accounts?status=error|all
// Returns sub2api admin accounts whose name matches `${prefix}\d+`.
export async function GET(
  req: Request,
  ctx: { params: Promise<{ siteId: string }> },
) {
  const { siteId } = await ctx.params;
  const id = Number(siteId);
  const url = new URL(req.url);
  const status = url.searchParams.get("status") || undefined;

  const preset = await prisma.azPreset.findUnique({
    where: { siteAccountId: id },
  });
  const cfg = readConfig(preset?.config);
  const re = new RegExp(`^${cfg.account_prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\d+$`);

  try {
    const client = await makeSiteClient(id);
    const r = await client.listAdminAccountsFiltered({
      search: cfg.account_prefix,
      status,
      page_size: 1000,
    });
    const items = r.items.filter((a) => re.test(a.name));
    return NextResponse.json({
      items,
      total: items.length,
      prefix: cfg.account_prefix,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
