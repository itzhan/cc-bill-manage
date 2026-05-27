import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { makeUpstreamApiClient } from "@/lib/upstream-client";

export const runtime = "nodejs";

// POST /api/bench/import-upstream-key
// body: { upstreamKeyId: number, channelName?: string, keyName?: string }
//
// 把 UpstreamKey 一键导入 /bench: 按 baseUrl 复用或新建 BenchChannel,
// 然后按 (channelId, apiKey) 去重创建 BenchChannelKey。
// 如果 DB 里 apiKey 为空 (旧行 / 上游只回 mask), 现场调上游 /api/v1/keys
// 拿全文; 拿不到就提示用户手动复制完整 key 再操作。
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Partial<{
    upstreamKeyId: number;
    channelName: string;
    keyName: string;
  }>;
  const upstreamKeyId = Number(body.upstreamKeyId);
  if (!Number.isFinite(upstreamKeyId) || upstreamKeyId <= 0) {
    return NextResponse.json(
      { error: "upstreamKeyId required" },
      { status: 400 },
    );
  }
  const row = await prisma.upstreamKey.findUnique({
    where: { id: upstreamKeyId },
    include: { upstreamAccount: true },
  });
  if (!row) {
    return NextResponse.json({ error: "upstream key not found" }, { status: 404 });
  }
  const acc = row.upstreamAccount;

  // 1) 获取完整 apiKey: DB 有就用; 没有就现场拉一次。
  let apiKey: string | null = row.apiKey ?? null;
  let revealError: string | null = null;
  if (!apiKey || /\*/.test(apiKey)) {
    try {
      const client = makeUpstreamApiClient({
        id: acc.id,
        type: acc.type,
        baseUrl: acc.baseUrl,
        email: acc.email,
        password: acc.password,
        accessToken: acc.accessToken,
        remoteUserId: acc.remoteUserId,
      });
      const items = await client.listKeys();
      const match = items.find((k) => k.id === row.remoteKeyId);
      if (match && typeof match.key === "string" && !/\*/.test(match.key)) {
        apiKey = match.key;
      } else if (match && typeof match.key === "string") {
        // 上游返回的也是 mask, 没法用 — 让用户手动处理。
        revealError = "上游返回的 key 已被脱敏, 无法获取完整值";
      }
    } catch (e) {
      revealError = e instanceof Error ? e.message : String(e);
    }
  }
  if (!apiKey || /\*/.test(apiKey)) {
    return NextResponse.json(
      {
        error: `无法获取完整 api key${revealError ? ` (${revealError})` : ""}, 请先手动复制后在 /bench 页面创建`,
      },
      { status: 400 },
    );
  }

  // 2) BenchChannel: 按 baseUrl 复用; 没有就创建。channel name 优先用前端传的,
  // 没传就用上游账号名。baseUrl 去尾 slash, 跟 BenchChannel POST 一致。
  const baseUrl = (acc.baseUrl ?? "").trim().replace(/\/$/, "");
  if (!baseUrl) {
    return NextResponse.json(
      { error: "upstream account 没有 baseUrl" },
      { status: 400 },
    );
  }
  let channel = await prisma.benchChannel.findFirst({ where: { baseUrl } });
  let channelCreated = false;
  if (!channel) {
    channel = await prisma.benchChannel.create({
      data: {
        name: (body.channelName ?? acc.name ?? `account#${acc.id}`).trim(),
        baseUrl,
        notes: `来自上游账号 ${acc.name} (id=${acc.id})`,
      },
    });
    channelCreated = true;
  }

  // 3) BenchChannelKey: (channelId, apiKey) 去重
  let key = await prisma.benchChannelKey.findFirst({
    where: { channelId: channel.id, apiKey },
  });
  let keyCreated = false;
  if (!key) {
    const keyName = (
      body.keyName ??
      row.name ??
      row.keyMasked ??
      `key#${row.id}`
    ).trim();
    key = await prisma.benchChannelKey.create({
      data: {
        channelId: channel.id,
        name: keyName,
        apiKey,
        notes: `来自上游 key ${row.name} (id=${row.id})`,
      },
    });
    keyCreated = true;
  }

  return NextResponse.json({
    ok: true,
    channelId: channel.id,
    keyId: key.id,
    channelCreated,
    keyCreated,
  });
}
