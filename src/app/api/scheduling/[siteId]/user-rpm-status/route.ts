import { NextResponse } from "next/server";
import { makeSiteClient } from "@/lib/az-server";

export const runtime = "nodejs";

// Fan-out rpm-status for a list of user IDs.
//   GET /api/scheduling/[siteId]/user-rpm-status?userIds=1,2,3
// Each upstream call is per-user; this route runs them in parallel so the
// client only pays a single round-trip per poll. Errors per user are
// swallowed (that user is just omitted from the result).
export async function GET(
  req: Request,
  ctx: { params: Promise<{ siteId: string }> },
) {
  const { siteId } = await ctx.params;
  const id = Number(siteId);
  const url = new URL(req.url);
  const raw = url.searchParams.get("userIds") ?? "";
  const userIds = Array.from(
    new Set(
      raw
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0),
    ),
  );
  if (userIds.length === 0) {
    return NextResponse.json({ siteId: id, status: {} });
  }
  // Defensive cap — the top-N panel won't realistically ask for more, and
  // a runaway caller shouldn't be able to fan out unbounded.
  const capped = userIds.slice(0, 20);
  try {
    const client = await makeSiteClient(id);
    const results = await Promise.all(
      capped.map((uid) =>
        client
          .getUserRpmStatus(uid)
          .then((r) => [uid, r] as const)
          .catch(() => [uid, null] as const),
      ),
    );
    const status: Record<string, unknown> = {};
    for (const [uid, r] of results) {
      if (r != null) status[String(uid)] = r;
    }
    return NextResponse.json({ siteId: id, status });
  } catch (e) {
    return NextResponse.json(
      { siteId: id, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
