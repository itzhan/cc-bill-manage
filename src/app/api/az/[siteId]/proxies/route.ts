import { NextResponse } from "next/server";
import { makeSiteClient } from "@/lib/az-server";

export const runtime = "nodejs";

// Returns the upstream proxy list for the proxy picker in az import.
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ siteId: string }> },
) {
  const { siteId } = await ctx.params;
  const id = Number(siteId);
  const client = await makeSiteClient(id);
  const proxies = await client.listAdminProxiesAll();
  const items = proxies.map((p) => ({
    id: p.id,
    name: p.name,
    protocol: p.protocol,
    host: p.host,
    port: p.port,
  }));
  // Sort by trailing number in name (proxy-1, proxy-2, ...) then by name.
  items.sort((a, b) => {
    const ma = a.name.match(/(\d+)$/);
    const mb = b.name.match(/(\d+)$/);
    if (ma && mb) return Number(ma[1]) - Number(mb[1]);
    return a.name.localeCompare(b.name);
  });
  return NextResponse.json({ items });
}
