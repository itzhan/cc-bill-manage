import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { makeUpstreamApiClient } from "@/lib/upstream-client";

export const runtime = "nodejs";

// GET a single UpstreamKey: row + parent baseUrl + (best-effort) the FULL
// api key by re-listing from upstream. We only store keyMasked locally,
// so the full value has to come from the live upstream call. Auth is
// handled by middleware (admin session).
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const numId = Number(id);
  const row = await prisma.upstreamKey.findUnique({
    where: { id: numId },
    include: { upstreamAccount: true },
  });
  if (!row) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  let fullKey: string | null = null;
  let revealError: string | null = null;
  try {
    const client = makeUpstreamApiClient({
      id: row.upstreamAccount.id,
      type: row.upstreamAccount.type,
      baseUrl: row.upstreamAccount.baseUrl,
      email: row.upstreamAccount.email,
      password: row.upstreamAccount.password,
      accessToken: row.upstreamAccount.accessToken,
      remoteUserId: row.upstreamAccount.remoteUserId,
    });
    const items = await client.listKeys();
    const match = items.find((k) => k.id === row.remoteKeyId);
    if (match && typeof match.key === "string") {
      // sub2api returns the full plaintext key on /api/v1/keys (it's the
      // user's own keys page). Some builds may already mask — caller has
      // to handle a masked-looking string.
      fullKey = match.key;
    }
  } catch (e) {
    revealError = e instanceof Error ? e.message : String(e);
  }
  return NextResponse.json({
    item: {
      id: row.id,
      name: row.name,
      keyMasked: row.keyMasked,
      groupName: row.groupName,
      remoteKeyId: row.remoteKeyId,
      apiKey: fullKey,
      revealError,
      channel: {
        id: row.upstreamAccount.id,
        name: row.upstreamAccount.name,
        baseUrl: row.upstreamAccount.baseUrl,
      },
    },
  });
}

// PATCH a single UpstreamKey row. Currently only `rechargeMultiplier`
// is editable from the UI — discount factor for the credits we hold.
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as Partial<{
    rechargeMultiplier: number;
  }>;
  const data: Record<string, unknown> = {};
  if (typeof body.rechargeMultiplier === "number") {
    if (!Number.isFinite(body.rechargeMultiplier) || body.rechargeMultiplier < 0) {
      return NextResponse.json(
        { error: "rechargeMultiplier must be a non-negative number" },
        { status: 400 },
      );
    }
    data.rechargeMultiplier = body.rechargeMultiplier;
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "no editable field provided" }, {
      status: 400,
    });
  }
  const item = await prisma.upstreamKey.update({
    where: { id: Number(id) },
    data,
  });
  return NextResponse.json({ item });
}
