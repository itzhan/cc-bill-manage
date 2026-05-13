import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// 一次性执行 auto-match 返回的计划。
// body:
//   {
//     proposed: [{ siteBoundAccountId, upstreamKeyId }],
//     misbound: [{ siteBoundAccountId, currentBindingId, correctUpstreamKeyId }],
//   }
//
// proposed → 创建新 binding
// misbound → 删除 currentBindingId + 创建 (siteBoundAccountId, correctUpstreamKeyId)
//
// 整个过程包在一个事务里 — 任一步失败回滚整批。
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Partial<{
    proposed: Array<{ siteBoundAccountId: number; upstreamKeyId: number }>;
    misbound: Array<{
      siteBoundAccountId: number;
      currentBindingId: number;
      correctUpstreamKeyId: number;
    }>;
  }>;
  const proposed = Array.isArray(body.proposed) ? body.proposed : [];
  const misbound = Array.isArray(body.misbound) ? body.misbound : [];

  if (proposed.length === 0 && misbound.length === 0) {
    return NextResponse.json({ created: 0, replaced: 0 });
  }

  try {
    const ops = [
      // 1) 删旧错绑
      ...misbound.map((m) =>
        prisma.binding.delete({ where: { id: m.currentBindingId } }),
      ),
      // 2) 建新绑定（新的 + 替换的）
      ...proposed.map((p) =>
        prisma.binding.create({
          data: {
            siteBoundAccountId: p.siteBoundAccountId,
            upstreamKeyId: p.upstreamKeyId,
          },
        }),
      ),
      ...misbound.map((m) =>
        prisma.binding.create({
          data: {
            siteBoundAccountId: m.siteBoundAccountId,
            upstreamKeyId: m.correctUpstreamKeyId,
          },
        }),
      ),
    ];
    await prisma.$transaction(ops);
    return NextResponse.json({
      created: proposed.length + misbound.length,
      replaced: misbound.length,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
