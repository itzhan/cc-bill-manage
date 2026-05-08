import { NextResponse } from "next/server";
import { makeSiteClient } from "@/lib/az-server";

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
    // Fire snapshot in parallel with the first page — it returns SLA /
    // error_rate / upstream_error_rate for the same time window so the UI
    // can show "请求错误率 X%, 上游错误率 Y%" alongside the per-account ranking.
    const snapshotPromise = client
      .getOpsSnapshot({ timeRange: range })
      .catch(() => null);
    const accs = new Map<number, AggregatedAccount>();
    let page = 1;
    let pages = 1;
    let total = 0;
    let truncated = false;
    let processed = 0;
    while (page <= pages) {
      if (page > MAX_PAGES) {
        truncated = true;
        break;
      }
      const r = await client.listRequestErrors({
        page,
        pageSize: PAGE_SIZE,
        timeRange: range,
        view: "errors",
      });
      total = r.total;
      pages = r.pages;
      for (const e of r.items) {
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
          // Items arrive DESC by created_at, so first 200 captured = latest 200.
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
      processed += r.items.length;
      if (r.items.length === 0) break;
      page++;
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
