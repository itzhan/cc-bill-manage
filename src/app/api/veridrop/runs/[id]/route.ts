import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// GET /api/veridrop/runs/[id] → status + (when done) parsed report
// reportJson 解析后塞回顶层 `report` 字段, 前端直接拿 detectors[]/performance 等渲染。
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const runId = Number(id);
  if (!Number.isFinite(runId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const row = await prisma.veridropRun.findUnique({
    where: { id: runId },
  });
  if (!row) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  let report: unknown = null;
  if (row.reportJson) {
    try {
      report = JSON.parse(row.reportJson);
    } catch {
      // 不应该发生 — 落库前已经 JSON.parse 过一次, 但容错。
      report = null;
    }
  }
  return NextResponse.json({
    id: row.id,
    channelKeyId: row.channelKeyId,
    protocol: row.protocol,
    mode: row.mode,
    model: row.model,
    status: row.status,
    totalScore: row.totalScore,
    verdict: row.verdict,
    summary: row.summary,
    errorText: row.errorText,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    createdAt: row.createdAt,
    report,
  });
}
