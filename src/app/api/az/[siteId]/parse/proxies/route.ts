import { NextResponse } from "next/server";
import { makeSiteClient } from "@/lib/az-server";
import { parseProxyText, nextSequenceNumber, readConfig } from "@/lib/az";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ siteId: string }> },
) {
  const { siteId } = await ctx.params;
  const id = Number(siteId);
  const body = (await req.json().catch(() => ({}))) as { text?: string };
  const text = body.text ?? "";
  const parsed = parseProxyText(text);

  const preset = await prisma.azPreset.findUnique({
    where: { siteAccountId: id },
  });
  const cfg = readConfig(preset?.config);

  let existingProxies: Array<{ host: string; port: number; username?: string; password?: string; name: string }> = [];
  let existingNames: string[] = [];
  try {
    const client = await makeSiteClient(id);
    const all = await client.listAdminProxiesAll();
    existingProxies = all.map((p) => ({
      host: p.host,
      port: p.port,
      username: p.username,
      password: p.password,
      name: p.name,
    }));
    existingNames = all.map((p) => p.name);
  } catch (e) {
    return NextResponse.json(
      { error: "查询服务端失败：" + (e instanceof Error ? e.message : String(e)) },
      { status: 500 },
    );
  }

  const dupKey = (p: { host: string; port: number; username: string; password: string }) =>
    `${p.host}|${p.port}|${p.username}|${p.password}`;
  const remoteKeys = new Set(
    existingProxies.map((p) => dupKey({
      host: p.host,
      port: p.port,
      username: p.username ?? "",
      password: p.password ?? "",
    })),
  );

  const seen = new Set<string>();
  const startNum = nextSequenceNumber(
    existingNames,
    cfg.proxy_prefix,
    cfg.proxy_start_index,
  );
  const rows = parsed.map((p, i) => {
    const k = dupKey(p);
    const inputDup = seen.has(k);
    seen.add(k);
    const remoteDup = remoteKeys.has(k);
    return {
      index: p.index,
      proposedName: `${cfg.proxy_prefix}${startNum + i}`,
      host: p.host,
      port: p.port,
      username: p.username,
      password: p.password,
      protocol: cfg.proxy_protocol,
      warnings: [
        ...(inputDup ? ["与同一批次内的另一行重复"] : []),
        ...(remoteDup ? ["服务端已存在相同代理"] : []),
      ],
      skip: inputDup || remoteDup,
    };
  });

  return NextResponse.json({
    rows,
    nextSequenceStart: startNum,
    existingProxyCount: existingNames.length,
  });
}
