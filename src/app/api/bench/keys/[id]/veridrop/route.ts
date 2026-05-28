import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { startVeridropRun } from "@/lib/veridrop";

export const runtime = "nodejs";

// POST /api/bench/keys/[id]/veridrop  → 起一次 veridrop 检测
// body: { mode?: "quick"|"standard"|"full", protocol?: "anthropic"|"openai"|"gemini", model?: string }
// 返回 { runId } — 用 GET /api/veridrop/runs/[runId] 轮询状态。
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const channelKeyId = Number(id);
  if (!Number.isFinite(channelKeyId)) {
    return NextResponse.json({ error: "invalid key id" }, { status: 400 });
  }
  const body = (await req.json().catch(() => ({}))) as Partial<{
    mode: string;
    protocol: string;
    model: string;
  }>;
  const mode = ["quick", "standard", "full"].includes(body.mode ?? "")
    ? (body.mode as string)
    : "full";
  const protocol = ["anthropic", "openai", "gemini"].includes(
    body.protocol ?? "",
  )
    ? (body.protocol as string)
    : "anthropic";
  const model = (body.model ?? "").trim() || "claude-opus-4-7";

  const key = await prisma.benchChannelKey.findUnique({
    where: { id: channelKeyId },
  });
  if (!key) {
    return NextResponse.json({ error: "key not found" }, { status: 404 });
  }
  try {
    const { id: runId } = await startVeridropRun({
      channelKeyId,
      protocol,
      mode,
      model,
    });
    return NextResponse.json({ runId });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

// GET /api/bench/keys/[id]/veridrop  → list veridrop runs for this key (newest first)
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const channelKeyId = Number(id);
  if (!Number.isFinite(channelKeyId)) {
    return NextResponse.json({ error: "invalid key id" }, { status: 400 });
  }
  const items = await prisma.veridropRun.findMany({
    where: { channelKeyId },
    orderBy: { id: "desc" },
    take: 20,
    select: {
      id: true,
      protocol: true,
      mode: true,
      model: true,
      status: true,
      totalScore: true,
      verdict: true,
      summary: true,
      errorText: true,
      startedAt: true,
      finishedAt: true,
      createdAt: true,
    },
  });
  return NextResponse.json({ items });
}
