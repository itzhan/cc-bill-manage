import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

function maskKey(k: string): string {
  if (!k) return "";
  if (k.length <= 8) return k.replace(/./g, "*");
  return `${k.slice(0, 4)}...${k.slice(-4)}`;
}

// GET — list channels with their keys + each key's latest run summary.
// Single round-trip so the /bench page can render without N waterfalls.
export async function GET() {
  const channels = await prisma.benchChannel.findMany({
    orderBy: { id: "asc" },
    include: {
      keys: {
        orderBy: { id: "asc" },
        include: {
          runs: {
            orderBy: { id: "desc" },
            take: 1,
            select: {
              id: true,
              status: true,
              probeStatus: true,
              probeVerdict: true,
              probeAuthenticityScore: true,
              mustHavePassRate: true,
              taskResolveRate: true,
              completedCount: true,
              failedCount: true,
              totalCount: true,
              n: true,
              model: true,
              createdAt: true,
              startedAt: true,
              finishedAt: true,
            },
          },
        },
      },
    },
  });
  const items = channels.map((c) => ({
    id: c.id,
    name: c.name,
    baseUrl: c.baseUrl,
    notes: c.notes,
    createdAt: c.createdAt,
    keys: c.keys.map((k) => ({
      id: k.id,
      name: k.name,
      apiKeyMasked: maskKey(k.apiKey),
      notes: k.notes,
      latestRun: k.runs[0] ?? null,
    })),
  }));
  return NextResponse.json({ items });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Partial<{
    name: string;
    baseUrl: string;
    notes: string;
  }>;
  const name = (body.name ?? "").trim();
  const baseUrl = (body.baseUrl ?? "").trim().replace(/\/$/, "");
  if (!name || !baseUrl) {
    return NextResponse.json(
      { error: "name 和 baseUrl 必填" },
      { status: 400 },
    );
  }
  const created = await prisma.benchChannel.create({
    data: { name, baseUrl, notes: body.notes ?? null },
  });
  return NextResponse.json({ item: created });
}
