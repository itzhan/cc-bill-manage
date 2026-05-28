import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { makeSiteClient } from "@/lib/az-server";
import { refreshSiteAccount } from "@/lib/sync";

export const runtime = "nodejs";
// 每个 token 要 cookie-auth + create 两步, 都跨 Claude 网络 — 留 3 分钟裕量。
export const maxDuration = 180;

// POST /api/site/[id]/import-sk-ant
// body: {
//   tokens: string[],               // sub2api session key (sk-ant-sid01-...), 一行一个
//   namePrefix?: string,            // 留空 = 直接用 sk 当账号名(方便人工对账)
//                                   // 非空 = "prefix-N", N 从已有最大 +1 续上
//   concurrency: number,
//   windowCostLimit: number,        // 5h 金额上限 USD, 0 = 不启用
//   windowCostStickyReserve?: number,
//   rateMultiplier?: number,
//   groupIds?: number[],
// }
//
// 行为(对每个 session key 走完整 setup-token 流程):
//   step1: setupTokenCookieAuth(sk) → 后端去 Claude 换出
//          { access_token, refresh_token, expires_at, org_uuid,
//            account_uuid, email_address }
//   step2: createAdminAccount(type=setup-token, credentials={...tokenInfo},
//          extra={ org_uuid, account_uuid, email_address, window_cost_limit })
//
// 命名:
//   - 留空前缀: 账号名 = sk 字符串本身 (跟我们之前的 setup-token 流程一致,
//     方便售后直接拿 sk 在 sub2api admin UI 里搜)
//   - 有前缀  : prefix-N, 用 listAdminAccountsFiltered 找已有最大 +1
//   不论成功失败 N 都 +1, 避免名字冲突死循环。
//
// 返回 { total, success, failed, startIdx?, results }
// results[i] = { tokenMasked, name, ok, stage?, error?, remoteAccountId? }
//   stage 用于售后定位: "cookie-auth" 或 "create"
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
  if (namePrefix && !/^[A-Za-z0-9._-]+$/.test(namePrefix)) {
    return NextResponse.json(
      { error: "namePrefix 只允许字母/数字/._-, 留空 = 直接用 sk" },
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

  // 只有走 prefix 模式时才需要算起始 idx
  let startIdx = 1;
  if (namePrefix) {
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
      // 拉不到列表不阻塞, 从 1 起步
      console.error("[import-sk-ant] list filter failed:", e);
    }
  }

  type Result = {
    tokenMasked: string;
    name: string;
    ok: boolean;
    stage?: "cookie-auth" | "create";
    error?: string;
    remoteAccountId?: number;
  };

  const results: Result[] = [];
  let nextIdx = startIdx;

  for (const token of tokens) {
    const tokenMasked = maskToken(token);
    const name = namePrefix ? `${namePrefix}-${nextIdx}` : token;
    if (namePrefix) nextIdx++; // 不论成败都续 — 避免名字冲突死循环

    if (!token.startsWith("sk-ant-")) {
      results.push({
        tokenMasked,
        name,
        ok: false,
        stage: "cookie-auth",
        error: "token 不以 sk-ant- 开头, 跳过",
      });
      continue;
    }

    // === Step 1: cookie auth → tokenInfo ===
    let tokenInfo: Awaited<ReturnType<typeof client.setupTokenCookieAuth>>;
    try {
      tokenInfo = await client.setupTokenCookieAuth(token);
    } catch (e) {
      results.push({
        tokenMasked,
        name,
        ok: false,
        stage: "cookie-auth",
        error: e instanceof Error ? e.message.slice(0, 300) : String(e),
      });
      continue;
    }
    if (!tokenInfo || typeof tokenInfo.access_token !== "string" || !tokenInfo.access_token) {
      results.push({
        tokenMasked,
        name,
        ok: false,
        stage: "cookie-auth",
        error: "Claude 未返回 access_token, 可能 sessionKey 已失效",
      });
      continue;
    }

    // === Step 2: createAdminAccount ===
    try {
      const extra: Record<string, unknown> = {};
      if (typeof tokenInfo.org_uuid === "string" && tokenInfo.org_uuid)
        extra.org_uuid = tokenInfo.org_uuid;
      if (typeof tokenInfo.account_uuid === "string" && tokenInfo.account_uuid)
        extra.account_uuid = tokenInfo.account_uuid;
      if (
        typeof tokenInfo.email_address === "string" &&
        tokenInfo.email_address
      )
        extra.email_address = tokenInfo.email_address;
      if (windowCostLimit > 0) {
        extra.window_cost_limit = windowCostLimit;
        if (windowCostStickyReserve > 0) {
          extra.window_cost_sticky_reserve = windowCostStickyReserve;
        }
      }
      // credentials 直接 spread tokenInfo, 跟 sub2api 前端
      // CreateAccountModal.vue:5241 行为一致 — 它把全部 tokenInfo 字段
      // 都塞进 credentials (access_token / refresh_token / expires_at 等)。
      const credentials: Record<string, unknown> = { ...tokenInfo };
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
        stage: "create",
        error: e instanceof Error ? e.message.slice(0, 300) : String(e),
      });
    }
  }

  // 一次 refresh, 让 SiteBoundAccount 跟进 — 失败也无所谓
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
    startIdx: namePrefix ? startIdx : null,
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
