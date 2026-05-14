import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { Sub2ApiClient } from "@/lib/sub2api";

export const runtime = "nodejs";
export const maxDuration = 120;

// 自动匹配绑定 — 返回绑定计划，不执行。
//
// 算法：
// 1. 从 DB 拉所有 UpstreamKey.apiKey != null，建 apiKey → upstreamKey 的索引。
// 2. 对每个 SiteBoundAccount（sub2api 类型），fan-out 调上游 sub2api
//    /admin/accounts/{id} 拿 credentials.api_key。
// 3. 拿到的 api_key 跟索引对碰：
//    - 已正确绑定 → alreadyCorrect
//    - 已绑别的 key → misbound（需要删旧 + 建新）
//    - 未绑定 → proposed（建新）
//    - 匹配不到任何 upstream key → unmatched
// 4. 任何中途失败的 site 账号 → errors[]
export async function POST() {
  // 1) 拉数据
  const [siteAccounts, siteBoundAll, upstreamKeys, allBindings, settings] =
    await Promise.all([
      prisma.siteAccount.findMany(),
      prisma.siteBoundAccount.findMany({ include: { siteAccount: true } }),
      prisma.upstreamKey.findMany({
        where: { apiKey: { not: null } },
        include: { upstreamAccount: true },
      }),
      prisma.binding.findMany({ where: { endedAt: null } }),
      prisma.settings.findUnique({
        where: { id: 1 },
        select: { unboundExcludePrefixes: true },
      }),
    ]);

  // 排除前缀（沿用"未绑定账号"那套设置）— 匹配的账号直接跳过，不算 misbound
  // 不算 unmatched 也不计入 errors。
  const excludePrefixes = (settings?.unboundExcludePrefixes ?? "")
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("#"));
  const isExcluded = (name: string) =>
    excludePrefixes.some((p) =>
      name.toLowerCase().startsWith(p.toLowerCase()),
    );
  const siteBound = siteBoundAll.filter((s) => !isExcluded(s.name));
  const excludedCount = siteBoundAll.length - siteBound.length;

  // upstreamKey 索引
  const upByKey = new Map<
    string,
    { id: number; label: string; rechargeMultiplier: number }
  >();
  for (const k of upstreamKeys) {
    if (!k.apiKey) continue;
    upByKey.set(k.apiKey, {
      id: k.id,
      label: `${k.upstreamAccount.name} / ${k.name}`,
      rechargeMultiplier: k.rechargeMultiplier,
    });
  }

  // 当前绑定快照：siteBoundAccountId → upstreamKeyId[]
  const currentBindingsBySite = new Map<number, { id: number; upstreamKeyId: number }[]>();
  for (const b of allBindings) {
    const arr = currentBindingsBySite.get(b.siteBoundAccountId) ?? [];
    arr.push({ id: b.id, upstreamKeyId: b.upstreamKeyId });
    currentBindingsBySite.set(b.siteBoundAccountId, arr);
  }

  // 2) 为每个 siteAccount 建一个 sub2api client，复用
  const clientCache = new Map<number, Sub2ApiClient>();
  function clientFor(siteAccountId: number): Sub2ApiClient | null {
    const cached = clientCache.get(siteAccountId);
    if (cached) return cached;
    const acc = siteAccounts.find((s) => s.id === siteAccountId);
    if (!acc) return null;
    if (acc.type !== "sub2api") return null; // 其他类型暂不支持
    const c = new Sub2ApiClient(
      {
        baseUrl: acc.baseUrl,
        email: acc.email,
        password: acc.password,
        apiKey: acc.apiKey,
        accessToken: acc.accessToken,
      },
      {
        onTokenRefreshed: async (newToken, expiresInSec) => {
          await prisma.siteAccount
            .update({
              where: { id: acc.id },
              data: {
                accessToken: newToken,
                tokenExpiresAt: new Date(Date.now() + expiresInSec * 1000),
              },
            })
            .catch(() => {});
        },
      },
    );
    clientCache.set(siteAccountId, c);
    return c;
  }

  // 3) 并发 10 个一组，拉 credentials.api_key
  interface Plan {
    proposed: Array<{
      siteBoundAccountId: number;
      siteLabel: string;
      upstreamKeyId: number;
      upstreamLabel: string;
    }>;
    misbound: Array<{
      siteBoundAccountId: number;
      siteLabel: string;
      currentBindingId: number;
      currentUpstreamKeyId: number;
      currentUpstreamLabel: string;
      correctUpstreamKeyId: number;
      correctUpstreamLabel: string;
    }>;
    alreadyCorrect: number;
    unmatched: Array<{
      siteBoundAccountId: number;
      siteLabel: string;
      apiKeyMasked: string;
    }>;
    errors: Array<{ siteBoundAccountId: number; siteLabel: string; error: string }>;
  }
  const plan: Plan = {
    proposed: [],
    misbound: [],
    alreadyCorrect: 0,
    unmatched: [],
    errors: [],
  };

  function maskKey(s: string): string {
    if (!s) return "";
    if (s.length <= 12) return s.slice(0, 3) + "***";
    return s.slice(0, 6) + "..." + s.slice(-4);
  }

  const queue = [...siteBound];
  const upstreamByKeyId = new Map<number, string>();
  for (const k of upstreamKeys) {
    upstreamByKeyId.set(k.id, `${k.upstreamAccount.name} / ${k.name}`);
  }

  async function worker() {
    while (queue.length > 0) {
      const s = queue.shift();
      if (!s) break;
      const siteLabel = `${s.siteAccount.name} / ${s.name}`;
      const c = clientFor(s.siteAccountId);
      if (!c) {
        plan.errors.push({
          siteBoundAccountId: s.id,
          siteLabel,
          error: "site account not sub2api type",
        });
        continue;
      }
      try {
        const acc = await c.getAdminAccount(s.remoteAccountId);
        const creds = (acc.credentials ?? {}) as Record<string, unknown>;
        const apiKey =
          typeof creds.api_key === "string" ? creds.api_key.trim() : "";
        if (!apiKey) {
          plan.errors.push({
            siteBoundAccountId: s.id,
            siteLabel,
            error: "no credentials.api_key on this account",
          });
          continue;
        }
        const target = upByKey.get(apiKey);
        const existing = currentBindingsBySite.get(s.id) ?? [];
        if (!target) {
          plan.unmatched.push({
            siteBoundAccountId: s.id,
            siteLabel,
            apiKeyMasked: maskKey(apiKey),
          });
          continue;
        }
        // 已正确绑定？
        const correctlyBoundIdx = existing.findIndex(
          (b) => b.upstreamKeyId === target.id,
        );
        if (correctlyBoundIdx >= 0) {
          plan.alreadyCorrect++;
          continue;
        }
        // 已绑别的？挑第一个作为"错绑"，给出替换计划
        if (existing.length > 0) {
          const wrong = existing[0];
          plan.misbound.push({
            siteBoundAccountId: s.id,
            siteLabel,
            currentBindingId: wrong.id,
            currentUpstreamKeyId: wrong.upstreamKeyId,
            currentUpstreamLabel:
              upstreamByKeyId.get(wrong.upstreamKeyId) ?? `#${wrong.upstreamKeyId}`,
            correctUpstreamKeyId: target.id,
            correctUpstreamLabel: target.label,
          });
        } else {
          plan.proposed.push({
            siteBoundAccountId: s.id,
            siteLabel,
            upstreamKeyId: target.id,
            upstreamLabel: target.label,
          });
        }
      } catch (e) {
        plan.errors.push({
          siteBoundAccountId: s.id,
          siteLabel,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(10, siteBound.length) }, () => worker()),
  );

  return NextResponse.json({
    summary: {
      totalSite: siteBound.length,
      excluded: excludedCount,
      totalUpstreamKey: upstreamKeys.length,
      newBindings: plan.proposed.length,
      misbound: plan.misbound.length,
      alreadyCorrect: plan.alreadyCorrect,
      unmatched: plan.unmatched.length,
      errors: plan.errors.length,
    },
    excludePrefixes,
    ...plan,
  });
}
