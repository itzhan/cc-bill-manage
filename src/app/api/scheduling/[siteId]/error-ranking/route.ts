import { NextResponse } from "next/server";
import { makeSiteClient, runWithLimit } from "@/lib/az-server";

export const runtime = "nodejs";
// Pulling errors over multiple pages can take a while when the time range
// is wide; lift the default 10s budget.
export const maxDuration = 120;

const ALLOWED_RANGES = new Set(["1h", "6h", "24h", "7d", "30d"]);
// Hard cap so a runaway query (e.g. millions of errors in 30d) doesn't blow
// up memory or wedge a request for minutes. With 500/page that's 50k events.
const MAX_PAGES = 100;
const PAGE_SIZE = 500;
// Per-account recent events kept on the response so the UI can drill in
// without a second roundtrip. Cap so the JSON doesn't balloon when one
// account has thousands of errors — top is usually enough for triage.
const RECENT_PER_ACCOUNT = 200;
// 翻页并发: sub2api 没有显式 rate limit, 8 路并发实测足以打满 sub2api
// 的处理能力; 再高边际收益递减且容易触发 502。
const PAGE_CONCURRENCY = 8;

interface RecentEvent {
  id: number;
  createdAt: string;
  statusCode: number;
  model: string;
  requestedModel: string;
  message: string;
  groupId: number | null;
  groupName: string;
  userId: number | null;
  userEmail: string;
  requestId: string;
  requestPath: string;
  isRetryable: boolean;
}

interface AggregatedAccount {
  accountId: number;
  accountName: string;
  count: number;
  byStatus: Record<string, number>;
  byModel: Record<string, number>;
  byGroup: Record<string, { groupId: number; groupName: string; count: number }>;
  latestAt: string;
  latestMessage: string;
  latestStatus: number;
  recentEvents: RecentEvent[];
}

// sub2api 一条错误事件 (我们关心的子集)。
interface RawErrItem {
  id: number;
  account_id?: number;
  account_name?: string;
  created_at: string;
  status_code?: number;
  message?: string;
  model?: string;
  requested_model?: string;
  group_id?: number;
  group_name?: string;
  user_id?: number;
  user_email?: string;
  request_id?: string;
  request_path?: string;
  is_retryable?: boolean;
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ siteId: string }> },
) {
  const { siteId } = await ctx.params;
  const url = new URL(req.url);
  const rangeRaw = url.searchParams.get("range") ?? "1h";
  const range = ALLOWED_RANGES.has(rangeRaw) ? rangeRaw : "1h";
  try {
    const client = await makeSiteClient(Number(siteId));
    // snapshot 跟第一页并行起飞,反正都要等。
    const snapshotPromise = client
      .getOpsSnapshot({ timeRange: range })
      .catch(() => null);

    // === Step 1: 先取第 1 页拿到 total / pages 元信息 ===
    const first = await client.listRequestErrors({
      page: 1,
      pageSize: PAGE_SIZE,
      timeRange: range,
      view: "errors",
    });
    const total = first.total;
    const pages = first.pages;
    const allItems: RawErrItem[] = [...(first.items as RawErrItem[])];

    // === Step 2: 剩余页面并发拉取 (受 MAX_PAGES 兜底) ===
    const effectivePages = Math.min(pages, MAX_PAGES);
    const truncated = pages > MAX_PAGES;
    if (effectivePages > 1) {
      const pageNumbers: number[] = [];
      for (let p = 2; p <= effectivePages; p++) pageNumbers.push(p);
      const pageResults = await runWithLimit<number, RawErrItem[]>(
        pageNumbers,
        PAGE_CONCURRENCY,
        async (p) => {
          try {
            const r = await client.listRequestErrors({
              page: p,
              pageSize: PAGE_SIZE,
              timeRange: range,
              view: "errors",
            });
            return r.items as RawErrItem[];
          } catch {
            // 某一页失败就当作空; 不阻塞其他页 — 总览仍有意义。
            return [];
          }
        },
      );
      for (const items of pageResults) {
        for (const it of items) allItems.push(it);
      }
    }
    const processed = allItems.length;

    // === Step 3: 全量按 created_at desc 排序, 再做 per-account 聚合 ===
    // 并发翻页打破了 "items arrive DESC by created_at" 的次序前提, 必须
    // 先排序, 否则 recentEvents 里 "最新 200" 的语义就丢了。
    allItems.sort((a, b) =>
      a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0,
    );

    const accs = new Map<number, AggregatedAccount>();
    for (const e of allItems) {
      if (!e.account_id) continue; // skip platform/inbound errors with no account
      let agg = accs.get(e.account_id);
      if (!agg) {
        agg = {
          accountId: e.account_id,
          accountName: e.account_name || `account#${e.account_id}`,
          count: 0,
          byStatus: {},
          byModel: {},
          byGroup: {},
          latestAt: e.created_at,
          latestMessage: e.message || "",
          latestStatus: e.status_code || 0,
          recentEvents: [],
        };
        accs.set(e.account_id, agg);
      }
      agg.count++;
      const sc = String(e.status_code || 0);
      agg.byStatus[sc] = (agg.byStatus[sc] ?? 0) + 1;
      const mdl = e.model || e.requested_model || "(unknown)";
      agg.byModel[mdl] = (agg.byModel[mdl] ?? 0) + 1;
      if (e.group_id) {
        const gk = String(e.group_id);
        const g = agg.byGroup[gk];
        if (g) g.count++;
        else
          agg.byGroup[gk] = {
            groupId: e.group_id,
            groupName: e.group_name || `group#${e.group_id}`,
            count: 1,
          };
      }
      if (agg.recentEvents.length < RECENT_PER_ACCOUNT) {
        // 排序后顺序仍然是 DESC by created_at, 所以前 N 个 = 最新 N 个。
        agg.recentEvents.push({
          id: e.id,
          createdAt: e.created_at,
          statusCode: e.status_code || 0,
          model: e.model || "",
          requestedModel: e.requested_model || "",
          message: (e.message || "").slice(0, 600),
          groupId: e.group_id ?? null,
          groupName: e.group_name || "",
          userId: e.user_id ?? null,
          userEmail: e.user_email || "",
          requestId: e.request_id || "",
          requestPath: e.request_path || "",
          isRetryable: e.is_retryable ?? false,
        });
      }
    }

    const ranking = [...accs.values()].sort((a, b) => b.count - a.count);
    const snap = await snapshotPromise;
    const summary = snap
      ? {
          errorRate: snap.overview.error_rate ?? 0,
          upstreamErrorRate: snap.overview.upstream_error_rate ?? 0,
          sla: snap.overview.sla ?? 0,
          requestCountTotal: snap.overview.request_count_total ?? 0,
          successCount: snap.overview.success_count ?? 0,
          errorCountTotal: snap.overview.error_count_total ?? 0,
          businessLimitedCount: snap.overview.business_limited_count ?? 0,
          errorCountSla: snap.overview.error_count_sla ?? 0,
          upstreamErrorCount429: snap.overview.upstream_429_count ?? 0,
          upstreamErrorCount529: snap.overview.upstream_529_count ?? 0,
          upstreamErrorCountOther:
            snap.overview.upstream_error_count_excl_429_529 ?? 0,
          healthScore: snap.overview.health_score ?? null,
          generatedAt: snap.generated_at,
        }
      : null;
    return NextResponse.json({
      range,
      totalErrors: total,
      processed,
      truncated,
      pages,
      maxPages: MAX_PAGES,
      pageSize: PAGE_SIZE,
      recentPerAccount: RECENT_PER_ACCOUNT,
      summary,
      accounts: ranking.map((a) => ({
        accountId: a.accountId,
        accountName: a.accountName,
        count: a.count,
        share: total > 0 ? a.count / total : 0,
        byStatus: a.byStatus,
        byModel: a.byModel,
        groups: Object.values(a.byGroup).sort((x, y) => y.count - x.count),
        latestAt: a.latestAt,
        latestMessage: a.latestMessage.slice(0, 300),
        latestStatus: a.latestStatus,
        recentEvents: a.recentEvents,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
