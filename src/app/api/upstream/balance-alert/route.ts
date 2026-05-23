import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET → list 所有渠道(只回与余额提醒相关的字段)
export async function GET() {
  const rows = await prisma.upstreamAccount.findMany({
    orderBy: { id: "asc" },
    select: {
      id: true,
      name: true,
      supplier: true,
      balance: true,
      balanceUpdatedAt: true,
      balanceAlertEnabled: true,
      balanceAlertIntervalMin: true,
      balanceAlertThresholdsJson: true,
      balanceAlertFiredJson: true,
      balanceAlertLastCheckAt: true,
    },
  });
  const items = rows.map((r) => ({
    id: r.id,
    name: r.name,
    supplier: r.supplier,
    balance: r.balance,
    balanceUpdatedAt: r.balanceUpdatedAt,
    enabled: r.balanceAlertEnabled,
    intervalMin: r.balanceAlertIntervalMin,
    thresholds: parseNums(r.balanceAlertThresholdsJson),
    fired: parseNums(r.balanceAlertFiredJson),
    lastCheckAt: r.balanceAlertLastCheckAt,
  }));
  return NextResponse.json({ items });
}

interface PatchItem {
  id?: number;
  enabled?: boolean;
  intervalMin?: number;
  thresholds?: number[];
}

// PATCH → 批量更新。body { items: [{id, enabled, intervalMin, thresholds}] }
//   - 修改 thresholds 时, 自动把 fired 里不再属于 thresholds 的项剔除
//     (旧阈值已经"过时", 不应该锁住任何阈值)。
export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { items?: PatchItem[] };
  const items = Array.isArray(body.items) ? body.items : [];
  let updated = 0;
  for (const it of items) {
    const id = Number(it.id);
    if (!id) continue;
    const enabled = Boolean(it.enabled);
    const intervalMin = Math.max(
      1,
      Math.floor(Number(it.intervalMin) || 60),
    );
    const thresholds = Array.isArray(it.thresholds)
      ? Array.from(
          new Set(
            it.thresholds
              .map((n) => Number(n))
              .filter((n) => Number.isFinite(n) && n > 0),
          ),
        ).sort((x, y) => y - x)
      : [];
    // 拿现存 fired,剔除已经被删除/不在 thresholds 里的阈值。
    const existing = await prisma.upstreamAccount.findUnique({
      where: { id },
      select: { balanceAlertFiredJson: true },
    });
    if (!existing) continue;
    const oldFired = parseNums(existing.balanceAlertFiredJson);
    const tSet = new Set(thresholds);
    const newFired = oldFired
      .filter((t) => tSet.has(t))
      .sort((x, y) => y - x);
    await prisma.upstreamAccount.update({
      where: { id },
      data: {
        balanceAlertEnabled: enabled,
        balanceAlertIntervalMin: intervalMin,
        balanceAlertThresholdsJson: JSON.stringify(thresholds),
        balanceAlertFiredJson: JSON.stringify(newFired),
      },
    });
    updated++;
  }
  return NextResponse.json({ updated });
}

function parseNums(raw: string | null | undefined): number[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v)
      ? v.map((x) => Number(x)).filter((n) => Number.isFinite(n))
      : [];
  } catch {
    return [];
  }
}
