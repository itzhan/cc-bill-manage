import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { makeSiteClient } from "@/lib/az-server";
import { refreshSiteAccount } from "@/lib/sync";

export const runtime = "nodejs";

// 默认模型白名单 — 跟 sub2api/魔改 前端 useModelWhitelist.ts 保持一致
// (引用: claudeModels / openaiModels / geminiModels)。push 到 site 时,
// 如果用户没特殊配模型映射, 用这些当 model_mapping (whitelist 模式)。
// 否则账号建出来 model_mapping 为空, sub2api 会把所有模型透传, 一般不
// 是用户想要的; 想限制反而要走完整 UI。
const DEFAULT_MODELS_BY_PLATFORM: Record<string, string[]> = {
  anthropic: [
    "claude-3-5-sonnet-20241022",
    "claude-3-5-sonnet-20240620",
    "claude-3-5-haiku-20241022",
    "claude-3-7-sonnet-20250219",
    "claude-sonnet-4-20250514",
    "claude-opus-4-20250514",
    "claude-opus-4-1-20250805",
    "claude-sonnet-4-5-20250929",
    "claude-haiku-4-5-20251001",
    "claude-opus-4-5-20251101",
    "claude-opus-4-6",
    "claude-opus-4-7",
    "claude-sonnet-4-6",
  ],
  openai: [
    "gpt-5.2",
    "gpt-5.2-2025-12-11",
    "gpt-5.2-chat-latest",
    "gpt-5.2-pro",
    "gpt-5.2-pro-2025-12-11",
    "gpt-5.5",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.4-2026-03-05",
    "gpt-5.3-codex",
    "gpt-5.3-codex-spark",
    "codex-auto-review",
    "gpt-4o-audio-preview",
    "gpt-4o-realtime-preview",
    "gpt-image-1",
    "gpt-image-1.5",
    "gpt-image-2",
  ],
  gemini: [
    "gemini-3.1-flash-image",
    "gemini-2.5-flash-image",
    "gemini-2.0-flash",
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "gemini-3-flash-preview",
    "gemini-3-pro-preview",
  ],
};

function defaultModelMapping(platform: string): Record<string, string> {
  const models = DEFAULT_MODELS_BY_PLATFORM[platform] ?? [];
  const map: Record<string, string> = {};
  for (const m of models) map[m] = m;
  return map;
}

// 把一条 upstream key 一键铺到 site:
// 1) 在目标 SiteAccount 上 createAdminAccount(用 key.apiKey + upstream.baseUrl)
// 2) refreshSiteAccount 把新账号拉回 SiteBoundAccount 表
// 3) 找到刚创建的 SiteBoundAccount, 建一条 binding (siteBoundAccountId → upstreamKeyId)
//
// 现状: 需要 upstream key 有 apiKey (raw) — sub2api 老版本只回 mask, 这时
// 此操作不可行, 返回 400 让 UI 提示用户。
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const keyId = Number(id);
  if (!Number.isFinite(keyId)) {
    return NextResponse.json({ error: "invalid key id" }, { status: 400 });
  }
  const body = (await req.json().catch(() => ({}))) as Partial<{
    siteAccountId: number;
    name: string;
    groupIds: number[];
    concurrency: number;
    rateMultiplier: number;
    priority: number;
    platform: string;
    type: string;
    geminiTier: string;
  }>;
  const {
    siteAccountId,
    name,
    groupIds,
    concurrency,
    rateMultiplier,
    priority = 1,
    platform = "anthropic",
    type = "apikey",
    geminiTier,
  } = body;
  // sub2api 后端校验 platform 必须是 anthropic/openai/gemini/antigravity
  if (!["anthropic", "openai", "gemini"].includes(platform)) {
    return NextResponse.json(
      { error: `不支持的 platform: ${platform}` },
      { status: 400 },
    );
  }
  if (
    !siteAccountId ||
    !name ||
    !Array.isArray(groupIds) ||
    groupIds.length === 0 ||
    !concurrency ||
    !rateMultiplier
  ) {
    return NextResponse.json(
      { error: "siteAccountId/name/groupIds/concurrency/rateMultiplier 必填" },
      { status: 400 },
    );
  }

  const key = await prisma.upstreamKey.findUnique({
    where: { id: keyId },
    include: { upstreamAccount: true },
  });
  if (!key) {
    return NextResponse.json({ error: "upstream key 不存在" }, { status: 404 });
  }
  if (!key.apiKey) {
    return NextResponse.json(
      {
        error:
          "此 upstream key 没有保存原始 apiKey (上游可能只回了 mask)。请去上游手动获取再粘贴, 或试试'完整刷新'。",
      },
      { status: 400 },
    );
  }

  const site = await prisma.siteAccount.findUnique({
    where: { id: Number(siteAccountId) },
  });
  if (!site) {
    return NextResponse.json({ error: "目标 site 不存在" }, { status: 404 });
  }
  if (site.type !== "sub2api") {
    return NextResponse.json(
      { error: "目前只支持 sub2api 站点" },
      { status: 400 },
    );
  }

  try {
    // 按 platform 拼 credentials. 三个平台 apikey type 都需要
    // base_url + api_key; gemini 额外要 tier_id (参考 sub2api 前端
    // CreateAccountModal.vue:4396)。
    // model_mapping 默认用平台内置白名单 — 不填的话 sub2api 不限制
    // 转发, 让所有模型都打过去; 一般用户其实想限制成 "本平台支持的
    // 那一批", 所以这里自动填上。
    const credentials: Record<string, unknown> = {
      base_url: key.upstreamAccount.baseUrl,
      api_key: key.apiKey,
      model_mapping: defaultModelMapping(platform),
    };
    if (platform === "gemini") {
      credentials.tier_id = geminiTier || "aistudio_paid";
    }
    const client = await makeSiteClient(Number(siteAccountId));
    const created = await client.createAdminAccount({
      name,
      platform,
      type,
      credentials,
      concurrency,
      priority, // 用户传入, 默认 1
      rate_multiplier: rateMultiplier,
      group_ids: groupIds,
      // 混渠道风险确认 — az 工具走的也是这条, 默认 true 否则上游会卡校验
      confirm_mixed_channel_risk: true,
    });

    // 拉一次让新账号进 SiteBoundAccount 表 — 然后才能拿来建 binding
    await refreshSiteAccount(Number(siteAccountId)).catch((e) => {
      console.error("[push-to-site] refresh after create failed:", e);
    });

    const newBound = await prisma.siteBoundAccount.findUnique({
      where: {
        siteAccountId_remoteAccountId: {
          siteAccountId: Number(siteAccountId),
          remoteAccountId: created.id,
        },
      },
    });
    if (!newBound) {
      return NextResponse.json(
        {
          error:
            "账号已建但同步未拉到, 请稍后手动同步;binding 未建立",
          remoteAccountId: created.id,
        },
        { status: 207 },
      );
    }

    await prisma.binding.create({
      data: {
        siteBoundAccountId: newBound.id,
        upstreamKeyId: keyId,
      },
    });

    return NextResponse.json({
      ok: true,
      remoteAccountId: created.id,
      siteBoundAccountId: newBound.id,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
