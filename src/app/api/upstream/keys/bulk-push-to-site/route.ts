import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { makeSiteClient, runWithLimit } from "@/lib/az-server";
import { refreshSiteAccount } from "@/lib/sync";

export const runtime = "nodejs";
// 批量 push 涉及 N 次 sub2api createAdminAccount + 一次 refresh, 给 2 分钟裕量。
export const maxDuration = 120;

// POST /api/upstream/keys/bulk-push-to-site
// body: {
//   upstreamKeyIds: number[],
//   siteAccountId: number,
//   templateRemoteAccountId: number,  // 模板账号在 sub2api 上的 admin account id
//   namePrefix?: string,
//   nameSuffix?: string,
// }
// 行为:
//   1. 用 client.getAdminAccount(templateRemoteAccountId) 拉模板的完整配置
//      (platform / type / concurrency / priority / rate_multiplier /
//       group_ids / credentials.* model_mapping/tier_id...)
//   2. 对每个 upstream key 用模板配置 + key.apiKey/baseUrl 创建账号
//      并发 5 路 (sub2api 写入不算特别贵, 太高怕触发 502)
//   3. 一次 refreshSiteAccount, 然后逐个建 binding
// 返回逐 key 的 result, 部分失败不阻塞其他 key。
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Partial<{
    upstreamKeyIds: number[];
    siteAccountId: number;
    templateRemoteAccountId: number;
    namePrefix: string;
    nameSuffix: string;
  }>;
  const upstreamKeyIds = (body.upstreamKeyIds ?? [])
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n) && n > 0);
  const siteAccountId = Number(body.siteAccountId);
  const templateRemoteAccountId = Number(body.templateRemoteAccountId);
  const namePrefix = (body.namePrefix ?? "").toString();
  const nameSuffix = (body.nameSuffix ?? "").toString();
  if (upstreamKeyIds.length === 0) {
    return NextResponse.json(
      { error: "upstreamKeyIds required" },
      { status: 400 },
    );
  }
  if (!siteAccountId || !templateRemoteAccountId) {
    return NextResponse.json(
      { error: "siteAccountId / templateRemoteAccountId required" },
      { status: 400 },
    );
  }

  const site = await prisma.siteAccount.findUnique({
    where: { id: siteAccountId },
  });
  if (!site) {
    return NextResponse.json({ error: "site not found" }, { status: 404 });
  }
  if (site.type !== "sub2api") {
    return NextResponse.json(
      { error: "目前只支持 sub2api 站点" },
      { status: 400 },
    );
  }

  // 拉所有 upstream key 一次, 检查 apiKey 都有(没 raw 没法 push)。
  const keys = await prisma.upstreamKey.findMany({
    where: { id: { in: upstreamKeyIds } },
    include: { upstreamAccount: true },
  });
  if (keys.length === 0) {
    return NextResponse.json(
      { error: "没找到任何 upstream key" },
      { status: 404 },
    );
  }

  const client = await makeSiteClient(siteAccountId);

  // 模板:拉一次拿到完整字段, sub2api 后端返回 platform/type/concurrency/
  // priority/rate_multiplier/group_ids/credentials 等, 我们就照搬。
  let tpl: Record<string, unknown>;
  try {
    tpl = (await client.getAdminAccount(templateRemoteAccountId)) as unknown as Record<string, unknown>;
  } catch (e) {
    return NextResponse.json(
      {
        error: `模板账号 #${templateRemoteAccountId} 拉取失败: ${e instanceof Error ? e.message : String(e)}`,
      },
      { status: 400 },
    );
  }
  const tplCredentials = (tpl.credentials as Record<string, unknown> | undefined) ?? {};
  const tplGroupIds = Array.isArray(tpl.group_ids)
    ? (tpl.group_ids as unknown[]).map((n) => Number(n)).filter((n) => Number.isFinite(n))
    : Array.isArray(tpl.groups)
      ? (tpl.groups as Array<{ id: number }>).map((g) => g.id).filter((n) => Number.isFinite(n))
      : [];
  const tplPlatform = typeof tpl.platform === "string" ? tpl.platform : "anthropic";
  const tplType = typeof tpl.type === "string" ? tpl.type : "apikey";
  const tplConcurrency = Number(tpl.concurrency ?? 0) || 10;
  const tplPriority = Number(tpl.priority ?? 0) || 1;
  const tplRateMultiplier = Number(tpl.rate_multiplier ?? 0) || 1;

  type KeyResult = {
    upstreamKeyId: number;
    keyName: string;
    ok: boolean;
    remoteAccountId?: number;
    siteBoundAccountId?: number;
    error?: string;
  };

  // === 创建阶段:5 路并发 ===
  const createResults = await runWithLimit<typeof keys[number], KeyResult>(
    keys,
    5,
    async (k) => {
      if (!k.apiKey) {
        return {
          upstreamKeyId: k.id,
          keyName: k.name,
          ok: false,
          error: "缺少完整 apiKey (上游可能只回了 mask)",
        };
      }
      try {
        // credentials 复用模板, 只把 base_url 和 api_key 换成当前 key 的
        const credentials: Record<string, unknown> = {
          ...tplCredentials,
          base_url: k.upstreamAccount.baseUrl,
          api_key: k.apiKey,
        };
        const name = `${namePrefix}${k.name}${nameSuffix}`.trim();
        if (!name) {
          return {
            upstreamKeyId: k.id,
            keyName: k.name,
            ok: false,
            error: "账号名空",
          };
        }
        const created = await client.createAdminAccount({
          name,
          platform: tplPlatform,
          type: tplType,
          credentials,
          concurrency: tplConcurrency,
          priority: tplPriority,
          rate_multiplier: tplRateMultiplier,
          group_ids: tplGroupIds,
          confirm_mixed_channel_risk: true,
        });
        return {
          upstreamKeyId: k.id,
          keyName: k.name,
          ok: true,
          remoteAccountId: created.id,
        };
      } catch (e) {
        return {
          upstreamKeyId: k.id,
          keyName: k.name,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
  );

  // === 同步阶段:全部创建完, 一次 refreshSiteAccount 把新账号拉回本地 ===
  try {
    await refreshSiteAccount(siteAccountId);
  } catch (e) {
    console.error("[bulk-push-to-site] refresh failed:", e);
  }

  // === binding 阶段:对成功创建的逐个建 binding ===
  for (const r of createResults) {
    if (!r.ok || r.remoteAccountId == null) continue;
    try {
      const bound = await prisma.siteBoundAccount.findUnique({
        where: {
          siteAccountId_remoteAccountId: {
            siteAccountId,
            remoteAccountId: r.remoteAccountId,
          },
        },
      });
      if (!bound) {
        r.ok = false;
        r.error = "账号已建但同步未拉到, binding 未建立";
        continue;
      }
      await prisma.binding.create({
        data: {
          siteBoundAccountId: bound.id,
          upstreamKeyId: r.upstreamKeyId,
        },
      });
      r.siteBoundAccountId = bound.id;
    } catch (e) {
      r.ok = false;
      r.error = `binding 建立失败: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  const success = createResults.filter((r) => r.ok).length;
  const failed = createResults.length - success;
  return NextResponse.json({
    total: createResults.length,
    success,
    failed,
    results: createResults,
  });
}
