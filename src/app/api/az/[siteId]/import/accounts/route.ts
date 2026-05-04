import { NextResponse } from "next/server";
import { makeSiteClient, runWithLimit } from "@/lib/az-server";
import { prisma } from "@/lib/db";
import { readConfig, nextSequenceNumber, type AzConfig } from "@/lib/az";

export const runtime = "nodejs";
export const maxDuration = 300;

interface InputRow {
  base_url: string;
  api_key: string;
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ siteId: string }> },
) {
  const { siteId } = await ctx.params;
  const id = Number(siteId);
  const body = (await req.json().catch(() => ({}))) as {
    rows?: InputRow[];
    overrides?: Partial<AzConfig>;
    cost?: number;
    singleProxyId?: number | null;
  };
  const inputRows = body.rows ?? [];
  const fixedCost =
    typeof body.cost === "number" && Number.isFinite(body.cost) && body.cost >= 0
      ? body.cost
      : null;
  const singleProxyId =
    typeof body.singleProxyId === "number" && Number.isFinite(body.singleProxyId)
      ? body.singleProxyId
      : null;
  if (inputRows.length === 0) {
    return NextResponse.json({ error: "空输入" }, { status: 400 });
  }

  const preset = await prisma.azPreset.findUnique({
    where: { siteAccountId: id },
  });
  const cfg: AzConfig = { ...readConfig(preset?.config), ...(body.overrides ?? {}) };

  const client = await makeSiteClient(id);

  // Re-pull existing names + unbound proxies right before submission to
  // avoid race with parallel users creating accounts.
  const existing = await client.listAdminAccountsFiltered({
    page_size: 1000,
  });
  const existingNames = existing.items.map((a) => a.name);
  // Build proxyByNum map keyed by trailing number in proxy name (proxy-13 → 13).
  // The default pairing rule is name-suffix match: az-N ↔ proxy-N.
  // We no longer rely on id order; that produced mismatches when a proxy was
  // deleted and recreated (its new id no longer matched its name's number).
  const proxyByNum = new Map<number, number>();
  if (cfg.auto_bind_proxy && singleProxyId == null) {
    const proxies = await client.listAdminProxiesAll();
    const usedProxyIds = new Set(
      existing.items
        .map((a) => (a as { proxy_id?: number | null }).proxy_id)
        .filter((x): x is number => x != null),
    );
    for (const p of proxies) {
      if (usedProxyIds.has(p.id)) continue;
      const m = p.name.match(/(\d+)$/);
      if (!m) continue;
      const num = Number(m[1]);
      // First-write-wins; duplicate-numbered proxies keep the lower id.
      if (!proxyByNum.has(num)) proxyByNum.set(num, p.id);
    }
  }

  const startNum = nextSequenceNumber(
    existingNames,
    cfg.account_prefix,
    cfg.account_start_index,
  );

  function pickProxyId(i: number): number | null {
    if (singleProxyId != null) return singleProxyId;
    if (cfg.auto_bind_proxy) {
      return proxyByNum.get(startNum + i) ?? null;
    }
    return null;
  }

  const tasks = inputRows.map((r, i) => ({
    name: `${cfg.account_prefix}${startNum + i}`,
    base_url: r.base_url,
    api_key: r.api_key,
    proxy_id: pickProxyId(i),
    index: i,
  }));

  type ResultRow = {
    name: string;
    ok: boolean;
    id?: number;
    error?: string;
  };

  const results = await runWithLimit<typeof tasks[number], ResultRow>(
    tasks,
    10,
    async (t) => {
      try {
        const res = await client.createAdminAccount({
          name: t.name,
          platform: cfg.platform,
          type: cfg.type,
          credentials: {
            base_url: t.base_url,
            api_key: t.api_key,
            model_mapping: cfg.model_mapping,
          },
          concurrency: cfg.concurrency,
          priority: cfg.priority,
          rate_multiplier: cfg.rate_multiplier,
          group_ids: cfg.group_ids,
          confirm_mixed_channel_risk: cfg.confirm_mixed_channel_risk,
          ...(t.proxy_id != null ? { proxy_id: t.proxy_id } : {}),
        });
        if (fixedCost != null) {
          await prisma.siteBoundAccount.upsert({
            where: {
              siteAccountId_remoteAccountId: {
                siteAccountId: id,
                remoteAccountId: res.id,
              },
            },
            create: {
              siteAccountId: id,
              remoteAccountId: res.id,
              name: t.name,
              fixedCost,
            },
            update: { fixedCost },
          });
        }
        return { name: t.name, ok: true, id: res.id };
      } catch (e) {
        return {
          name: t.name,
          ok: false,
          error: e instanceof Error ? e.message.slice(0, 300) : String(e),
        };
      }
    },
  );

  const ok = results.filter((r) => r.ok).length;
  const failed = results.length - ok;
  return NextResponse.json({
    total: results.length,
    ok,
    failed,
    rows: results,
  });
}
