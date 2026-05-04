import { NextResponse } from "next/server";
import { makeSiteClient } from "@/lib/az-server";
import { parseAccountText, nextSequenceNumber } from "@/lib/az";
import { prisma } from "@/lib/db";
import { readConfig } from "@/lib/az";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ siteId: string }> },
) {
  const { siteId } = await ctx.params;
  const id = Number(siteId);
  const body = (await req.json().catch(() => ({}))) as { text?: string };
  const text = body.text ?? "";
  const parsed = parseAccountText(text);

  // Load preset for naming convention
  const preset = await prisma.azPreset.findUnique({
    where: { siteAccountId: id },
  });
  const cfg = readConfig(preset?.config);

  // Hit upstream to learn current account names + proxies (for dedupe and
  // assigning the next az-N number)
  let existingNames: string[] = [];
  let unboundProxyIds: number[] = [];
  const proxyByNum = new Map<number, { id: number; name: string }>();
  try {
    const client = await makeSiteClient(id);
    // 1) existing account names matching az-prefix
    const accs = await client.listAdminAccountsFiltered({
      search: cfg.account_prefix,
      page_size: 1000,
    });
    existingNames = accs.items.map((a) => a.name);

    // 2) which proxies are already attached to some account
    if (cfg.auto_bind_proxy) {
      const all = await client.listAdminProxiesAll();
      const allAccs = await client.listAdminAccountsFiltered({
        page_size: 1000,
      });
      const usedProxyIds = new Set(
        allAccs.items.map((a) => (a as { proxy_id?: number }).proxy_id ?? null),
      );
      const unbound = all.filter((p) => !usedProxyIds.has(p.id));
      unboundProxyIds = unbound.map((p) => p.id);
      // name-suffix → id+name map (for az-N ↔ proxy-N pairing in preview/import)
      for (const p of unbound) {
        const m = p.name.match(/(\d+)$/);
        if (!m) continue;
        const num = Number(m[1]);
        if (!proxyByNum.has(num)) proxyByNum.set(num, { id: p.id, name: p.name });
      }
    }
  } catch (e) {
    return NextResponse.json(
      {
        error: "查询服务端失败：" + (e instanceof Error ? e.message : String(e)),
      },
      { status: 500 },
    );
  }

  // Detect duplicate (base_url + api_key) within input
  const seen = new Set<string>();
  const previewRows = parsed.map((p, i) => {
    const key = `${p.base_url}|${p.api_key}`;
    const isDup = seen.has(key);
    seen.add(key);
    const nextNum =
      nextSequenceNumber(
        existingNames,
        cfg.account_prefix,
        cfg.account_start_index,
      ) + i;
    const matched = cfg.auto_bind_proxy ? proxyByNum.get(nextNum) : undefined;
    return {
      index: p.index,
      proposedName: `${cfg.account_prefix}${nextNum}`,
      base_url: p.base_url,
      api_key: p.api_key,
      warnings: [
        ...p.warnings,
        ...(isDup ? ["与同一批次内的另一行重复"] : []),
        ...(cfg.auto_bind_proxy && !matched
          ? [`未找到对应代理 (proxy-${nextNum})`]
          : []),
      ],
      proxyId: matched?.id ?? null,
      proxyName: matched?.name ?? null,
    };
  });

  return NextResponse.json({
    rows: previewRows,
    nextSequenceStart: nextSequenceNumber(
      existingNames,
      cfg.account_prefix,
      cfg.account_start_index,
    ),
    existingAccountCount: existingNames.length,
    unboundProxyCount: unboundProxyIds.length,
  });
}
