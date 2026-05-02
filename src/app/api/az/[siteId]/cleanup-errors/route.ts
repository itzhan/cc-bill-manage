import { NextResponse } from "next/server";
import { makeSiteClient, runWithLimit } from "@/lib/az-server";

export const runtime = "nodejs";
export const maxDuration = 300;

// POST body: { mode: "delete" | "clear", account_ids: number[] }
//   delete: DELETE /admin/accounts/:id (no batch endpoint, parallel 10)
//   clear:  POST /admin/accounts/batch-clear-error (single call)
export async function POST(
  req: Request,
  ctx: { params: Promise<{ siteId: string }> },
) {
  const { siteId } = await ctx.params;
  const id = Number(siteId);
  const body = (await req.json().catch(() => ({}))) as {
    mode?: "delete" | "clear";
    account_ids?: number[];
  };
  const mode = body.mode ?? "delete";
  const ids = (body.account_ids ?? []).filter(
    (n) => Number.isFinite(n) && n > 0,
  );
  if (ids.length === 0) {
    return NextResponse.json({ error: "account_ids required" }, { status: 400 });
  }
  const client = await makeSiteClient(id);

  if (mode === "clear") {
    try {
      await client.clearAdminAccountsError(ids);
      return NextResponse.json({ mode, total: ids.length, ok: ids.length, failed: 0, rows: [] });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : String(e) },
        { status: 500 },
      );
    }
  }

  // delete mode
  type R = { id: number; ok: boolean; error?: string };
  const rows = await runWithLimit<number, R>(ids, 10, async (aid) => {
    try {
      await client.deleteAdminAccount(aid);
      return { id: aid, ok: true };
    } catch (e) {
      return {
        id: aid,
        ok: false,
        error: e instanceof Error ? e.message.slice(0, 300) : String(e),
      };
    }
  });
  const ok = rows.filter((r) => r.ok).length;
  return NextResponse.json({
    mode,
    total: ids.length,
    ok,
    failed: ids.length - ok,
    rows,
  });
}
