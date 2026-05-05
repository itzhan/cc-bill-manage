import { NextResponse } from "next/server";
import { makeSiteClient } from "@/lib/az-server";
import { prisma } from "@/lib/db";
import { readConfig } from "@/lib/az";

export const runtime = "nodejs";
export const maxDuration = 300;

// POST body: { account_ids: number[], updateModelMapping?: boolean }
// Applies the saved preset to the specified accounts in a single
// bulk-update call. When updateModelMapping is true, model_mapping is
// piggy-backed via `credentials.model_mapping` — sub2api server-side
// merges it into each account's existing credentials (verified against
// production curl).
export async function POST(
  req: Request,
  ctx: { params: Promise<{ siteId: string }> },
) {
  const { siteId } = await ctx.params;
  const id = Number(siteId);
  const body = (await req.json().catch(() => ({}))) as {
    account_ids?: number[];
    updateModelMapping?: boolean;
  };
  const ids = (body.account_ids ?? []).filter(
    (n) => Number.isFinite(n) && n > 0,
  );
  if (ids.length === 0) {
    return NextResponse.json({ error: "account_ids required" }, { status: 400 });
  }

  const preset = await prisma.azPreset.findUnique({
    where: { siteAccountId: id },
  });
  const cfg = readConfig(preset?.config);
  const client = await makeSiteClient(id);

  const payload: Record<string, unknown> = {
    account_ids: ids,
    concurrency: cfg.concurrency,
    priority: cfg.priority,
    rate_multiplier: cfg.rate_multiplier,
    group_ids: cfg.group_ids,
    confirm_mixed_channel_risk: cfg.confirm_mixed_channel_risk,
  };
  // Build credentials patch when there's anything to ship.
  const credentialsPatch: Record<string, unknown> = {};
  if (body.updateModelMapping) {
    credentialsPatch.model_mapping = cfg.model_mapping;
  }
  const tempRules = cfg.temp_unschedulable_rules ?? [];
  if (cfg.temp_unschedulable_enabled && tempRules.length > 0) {
    credentialsPatch.temp_unschedulable_enabled = true;
    credentialsPatch.temp_unschedulable_rules = tempRules;
  }
  if (Object.keys(credentialsPatch).length > 0) {
    payload.credentials = credentialsPatch;
  }

  try {
    await client.bulkUpdateAdminAccounts(
      payload as { account_ids: number[]; [k: string]: unknown },
    );
    return NextResponse.json({
      ok: true,
      targetCount: ids.length,
      includedWhitelist: !!body.updateModelMapping,
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        targetCount: ids.length,
        includedWhitelist: !!body.updateModelMapping,
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }
}
