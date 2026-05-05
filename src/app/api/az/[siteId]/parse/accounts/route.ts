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
  const body = (await req.json().catch(() => ({}))) as {
    text?: string;
    alias?: string;
  };
  const text = body.text ?? "";
  const alias = (body.alias ?? "").trim();
  const parsed = parseAccountText(text);

  // Load preset for naming convention
  const preset = await prisma.azPreset.findUnique({
    where: { siteAccountId: id },
  });
  const cfg = readConfig(preset?.config);
  // When alias is set, effective prefix becomes `{cfg.account_prefix}{alias}-`
  // (e.g. cfg.account_prefix=az- + alias=o总 → "az-o总-"). Numbering starts
  // from 1 within that namespace.
  const effectivePrefix = alias
    ? `${cfg.account_prefix}${alias}-`
    : cfg.account_prefix;
  const aliasMode = alias.length > 0;

  // Hit upstream to learn current account names + proxies (for dedupe and
  // assigning the next az-N number)
  let existingNames: string[] = [];
  let unboundProxyIds: number[] = [];
  const proxyByNum = new Map<number, { id: number; name: string }>();
  try {
    const client = await makeSiteClient(id);
    // ONE list of accounts (1000 page_size) covers both:
    //   - "existing names matching az-prefix" → filter client-side by name
    //   - "which proxies are already used"     → scan proxy_id field
    // Previously this fired listAdminAccountsFiltered TWICE.
    // alias mode disables proxy auto-bind (user picks one shared proxy at
    // submit time); skip the proxies fetch entirely in that mode.
    const wantProxies = cfg.auto_bind_proxy && !aliasMode;
    const [allAccsResp, allProxies] = await Promise.all([
      client.listAdminAccountsFiltered({ page_size: 1000 }),
      wantProxies
        ? client.listAdminProxiesAll()
        : Promise.resolve([] as Awaited<ReturnType<typeof client.listAdminProxiesAll>>),
    ]);
    const allAccounts = allAccsResp.items;
    // Match against effective prefix so alias namespaces have their own counter.
    existingNames = allAccounts
      .filter((a) => a.name.startsWith(effectivePrefix))
      .map((a) => a.name);

    if (wantProxies) {
      const usedProxyIds = new Set(
        allAccounts
          .map((a) => (a as { proxy_id?: number }).proxy_id ?? null)
          .filter((v): v is number => v != null),
      );
      const unbound = allProxies.filter((p) => !usedProxyIds.has(p.id));
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
  const proxyAuto = cfg.auto_bind_proxy && !aliasMode;
  const previewRows = parsed.map((p, i) => {
    const key = `${p.base_url}|${p.api_key}`;
    const isDup = seen.has(key);
    seen.add(key);
    const nextNum =
      nextSequenceNumber(
        existingNames,
        effectivePrefix,
        cfg.account_start_index,
      ) + i;
    const matched = proxyAuto ? proxyByNum.get(nextNum) : undefined;
    return {
      index: p.index,
      proposedName: `${effectivePrefix}${nextNum}`,
      base_url: p.base_url,
      api_key: p.api_key,
      warnings: [
        ...p.warnings,
        ...(isDup ? ["与同一批次内的另一行重复"] : []),
        ...(proxyAuto && !matched
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
      effectivePrefix,
      cfg.account_start_index,
    ),
    existingAccountCount: existingNames.length,
    unboundProxyCount: unboundProxyIds.length,
    aliasMode,
    effectivePrefix,
  });
}
