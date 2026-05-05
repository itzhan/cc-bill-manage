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
    alias?: string;
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
  const alias = (body.alias ?? "").trim();
  const aliasMode = alias.length > 0;
  if (inputRows.length === 0) {
    return NextResponse.json({ error: "空输入" }, { status: 400 });
  }

  const preset = await prisma.azPreset.findUnique({
    where: { siteAccountId: id },
  });
  const cfg: AzConfig = { ...readConfig(preset?.config), ...(body.overrides ?? {}) };

  // Effective prefix: cfg.account_prefix + alias-segment (when set).
  // Numbering counter is per-namespace.
  const effectivePrefix = aliasMode
    ? `${cfg.account_prefix}${alias}-`
    : cfg.account_prefix;

  // Alias mode requires a user-picked single proxy; auto-pair is disabled.
  if (aliasMode && cfg.auto_bind_proxy && singleProxyId == null) {
    return NextResponse.json(
      {
        error: "别称模式下需指定共用代理（singleProxyId）",
      },
      { status: 400 },
    );
  }

  const client = await makeSiteClient(id);

  // In alias mode the auto-pair path is disabled; only fetch proxies when
  // we'll actually use them (proxy auto-bind on AND no singleProxyId AND
  // not alias mode).
  const wantProxies =
    cfg.auto_bind_proxy && singleProxyId == null && !aliasMode;
  const [existing, proxies] = await Promise.all([
    client.listAdminAccountsFiltered({ page_size: 1000 }),
    wantProxies
      ? client.listAdminProxiesAll()
      : Promise.resolve([] as Awaited<ReturnType<typeof client.listAdminProxiesAll>>),
  ]);
  const existingNames = existing.items.map((a) => a.name);
  const proxyByNum = new Map<number, number>();
  if (wantProxies) {
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
      if (!proxyByNum.has(num)) proxyByNum.set(num, p.id);
    }
  }

  const startNum = nextSequenceNumber(
    existingNames,
    effectivePrefix,
    cfg.account_start_index,
  );

  function pickProxyId(i: number): number | null {
    if (singleProxyId != null) return singleProxyId;
    if (wantProxies) {
      return proxyByNum.get(startNum + i) ?? null;
    }
    return null;
  }

  const tasks = inputRows.map((r, i) => ({
    name: `${effectivePrefix}${startNum + i}`,
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
        // Temporary auto-pause on error+keyword match. Stored on sub2api
        // credentials as temp_unschedulable_enabled + temp_unschedulable_rules.
        const credentials: Record<string, unknown> = {
          base_url: t.base_url,
          api_key: t.api_key,
          model_mapping: cfg.model_mapping,
        };
        const tempRules = cfg.temp_unschedulable_rules ?? [];
        if (cfg.temp_unschedulable_enabled && tempRules.length > 0) {
          credentials.temp_unschedulable_enabled = true;
          credentials.temp_unschedulable_rules = tempRules;
        }
        const res = await client.createAdminAccount({
          name: t.name,
          platform: cfg.platform,
          type: cfg.type,
          credentials,
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
