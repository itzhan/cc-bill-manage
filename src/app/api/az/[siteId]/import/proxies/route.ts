import { NextResponse } from "next/server";
import { makeSiteClient, runWithLimit } from "@/lib/az-server";
import { prisma } from "@/lib/db";
import { readConfig, nextSequenceNumber } from "@/lib/az";

export const runtime = "nodejs";
export const maxDuration = 300;

interface InputRow {
  host: string;
  port: number;
  username: string;
  password: string;
  skip?: boolean;
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ siteId: string }> },
) {
  const { siteId } = await ctx.params;
  const id = Number(siteId);
  const body = (await req.json().catch(() => ({}))) as { rows?: InputRow[] };
  const inputRows = (body.rows ?? []).filter((r) => !r.skip);
  if (inputRows.length === 0) {
    return NextResponse.json({ error: "空输入或全部跳过" }, { status: 400 });
  }

  const preset = await prisma.azPreset.findUnique({
    where: { siteAccountId: id },
  });
  const cfg = readConfig(preset?.config);

  const client = await makeSiteClient(id);
  const existing = await client.listAdminProxiesAll();
  const existingNames = existing.map((p) => p.name);
  const startNum = nextSequenceNumber(
    existingNames,
    cfg.proxy_prefix,
    cfg.proxy_start_index,
  );

  const tasks = inputRows.map((r, i) => ({
    name: `${cfg.proxy_prefix}${startNum + i}`,
    host: r.host,
    port: r.port,
    username: r.username,
    password: r.password,
  }));

  type ResultRow = {
    name: string;
    ok: boolean;
    id?: number;
    error?: string;
  };

  const results = await runWithLimit<typeof tasks[number], ResultRow>(
    tasks,
    10,
    async (t) => {
      try {
        const res = await client.createAdminProxy({
          name: t.name,
          protocol: cfg.proxy_protocol,
          host: t.host,
          port: t.port,
          ...(t.username ? { username: t.username } : {}),
          ...(t.password ? { password: t.password } : {}),
        });
        return { name: t.name, ok: true, id: res.id };
      } catch (e) {
        return {
          name: t.name,
          ok: false,
          error: e instanceof Error ? e.message.slice(0, 300) : String(e),
        };
      }
    },
  );

  const ok = results.filter((r) => r.ok).length;
  return NextResponse.json({
    total: results.length,
    ok,
    failed: results.length - ok,
    rows: results,
  });
}
