import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { makeSiteClient } from "@/lib/az-server";
import { refreshSiteAccount } from "@/lib/sync";

export const runtime = "nodejs";
// 顺序创建 N 个 setup-token 账号, 给 3 分钟裕量。
export const maxDuration = 180;

// POST /api/site/[id]/import-sk-ant
// body: {
//   tokens: string[],               // 一行一个 sk-ant-... (会自动 trim & 去空行)
//   namePrefix: string,             // 例如 "max" → max-1 / max-2 / ...
//   concurrency: number,            // sub2api admin account concurrency
//   windowCostLimit: number,        // 5h 金额上限 USD, 0 = 不启用
//   windowCostStickyReserve?: number, // 默认 0
//   rateMultiplier?: number,        // 默认 1
//   groupIds?: number[],            // 默认 []
// }
//
// 行为:
//   1. 拿当前站点所有同前缀(search=namePrefix)账号, 解析 `^${prefix}-(\d+)$`
//      取最大数字 + 1 作为起点; 没有则从 1 开始
//   2. 顺序对每个 token 创建 admin account, 名字 = prefix-{nextIdx},
//      创建无论成败 nextIdx 都 +1(避免名字冲突死循环 & 给售后留可追溯线索)
//   3. 创建 body: platform=anthropic / type=setup-token / credentials=
//      { access_token, refresh_token: "", expires_at: now+1y }; extra=
//      { window_cost_limit, window_cost_sticky_reserve }
//   4. 全部跑完一次 refreshSiteAccount, 让本地 SiteBoundAccount 表同步
//   5. 返回 { total, success, failed, results: [{ tokenMasked, name, ok, error?, remoteAccountId? }] }
//      给前端列哪些成功 / 哪些失败, 方便售后定位。
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const siteId = Number(id);
  const body = (await req.json().catch(() => ({}))) as Partial<{
    tokens: string[];
    namePrefix: string;
    concurrency: number;
    windowCostLimit: number;
    windowCostStickyReserve: number;
    rateMultiplier: number;
    groupIds: number[];
  }>;

  const namePrefix = (body.namePrefix ?? "").trim();
  if (!namePrefix) {
    return NextResponse.json({ error: "namePrefix required" }, { status: 400 });
  }
  if (!/^[A-Za-z0-9._-]+$/.test(namePrefix)) {
    return NextResponse.json(
      { error: "namePrefix 只允许字母/数字/._-" },
      { status: 400 },
    );
  }
  const tokens = (body.tokens ?? [])
    .map((t) => String(t ?? "").trim())
    .filter((t) => t.length > 0);
  if (tokens.length === 0) {
    return NextResponse.json({ error: "tokens 至少 1 个" }, { status: 400 });
  }
  const concurrency = Math.max(1, Math.floor(Number(body.concurrency) || 0));
  if (!concurrency) {
    return NextResponse.json({ error: "concurrency 必填" }, { status: 400 });
  }
  const windowCostLimit = Math.max(0, Number(body.windowCostLimit) || 0);
  const windowCostStickyReserve = Math.max(
    0,
    Number(body.windowCostStickyReserve) || 0,
  );
  const rateMultiplier = Math.max(0, Number(body.rateMultiplier) || 0) || 1;
  const groupIds = Array.isArray(body.groupIds)
    ? body.groupIds.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0)
    : [];

  const site = await prisma.siteAccount.findUnique({ where: { id: siteId } });
  if (!site) {
    return NextResponse.json({ error: "site not found" }, { status: 404 });
  }
  if (site.type !== "sub2api") {
    return NextResponse.json(
      { error: "目前只支持 sub2api 站点" },
      { status: 400 },
    );
  }

  const client = await makeSiteClient(siteId);

  // === 找当前 max(同前缀数字) ===
  let startIdx = 1;
  try {
    const list = await client.listAdminAccountsFiltered({
      search: namePrefix,
      page_size: 1000,
    });
    const re = new RegExp(`^${escapeRegex(namePrefix)}-(\\d+)$`);
    let maxN = 0;
    for (const a of list.items ?? []) {
      const m = re.exec(a.name ?? "");
      if (!m) continue;
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > maxN) maxN = n;
    }
    startIdx = maxN + 1;
  } catch (e) {
    // 拉不到列表也别阻塞, 从 1 起步 + 让用户售后调整。
    console.error("[import-sk-ant] list filter failed:", e);
  }

  type Result = {
    tokenMasked: string;
    name: string;
    ok: boolean;
    error?: string;
    remoteAccountId?: number;
  };

  const results: Result[] = [];
  let nextIdx = startIdx;
  // 1 年后的 expires_at(setup-token 有效期 1 年, sub2api 内部刷新策略不动它)
  const expiresAt = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();

  // 顺序处理 — 避免 sub2api 内部 race 写 conflicting 名字;
  // 这部分批量真不大(典型几十到几百), 串行成本可接受。
  for (const token of tokens) {
    const tokenMasked = maskToken(token);
    const name = `${namePrefix}-${nextIdx}`;
    nextIdx++;

    if (!token.startsWith("sk-ant-")) {
      results.push({
        tokenMasked,
        name,
        ok: false,
        error: "token 不以 sk-ant- 开头, 跳过(避免误录)",
      });
      continue;
    }

    try {
      const credentials: Record<string, unknown> = {
        access_token: token,
        refresh_token: "",
        expires_at: expiresAt,
      };
      const extra: Record<string, unknown> = {};
      if (windowCostLimit > 0) {
        extra.window_cost_limit = windowCostLimit;
        if (windowCostStickyReserve > 0) {
          extra.window_cost_sticky_reserve = windowCostStickyReserve;
        }
      }
      const createBody: Record<string, unknown> = {
        name,
        platform: "anthropic",
        type: "setup-token",
        credentials,
        concurrency,
        priority: 1,
        rate_multiplier: rateMultiplier,
        group_ids: groupIds,
        confirm_mixed_channel_risk: true,
      };
      if (Object.keys(extra).length > 0) createBody.extra = extra;
      const created = await client.createAdminAccount(createBody);
      results.push({
        tokenMasked,
        name,
        ok: true,
        remoteAccountId: created.id,
      });
    } catch (e) {
      results.push({
        tokenMasked,
        name,
        ok: false,
        error: e instanceof Error ? e.message.slice(0, 300) : String(e),
      });
    }
  }

  // 跑一次 refresh 让 SiteBoundAccount 跟进, 失败也无所谓 — 用户下一次同步会拉到。
  try {
    await refreshSiteAccount(siteId);
  } catch (e) {
    console.error("[import-sk-ant] refresh failed:", e);
  }

  const success = results.filter((r) => r.ok).length;
  return NextResponse.json({
    total: results.length,
    success,
    failed: results.length - success,
    startIdx,
    results,
  });
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function maskToken(t: string): string {
  if (!t) return "";
  if (t.length <= 12) return `${t.slice(0, 4)}***`;
  return `${t.slice(0, 12)}...${t.slice(-4)}`;
}
