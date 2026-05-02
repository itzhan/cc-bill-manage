import { NextResponse } from "next/server";
import { backfillRange } from "@/lib/history";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Partial<{
    start: string;
    end: string;
  }>;
  const { start, end } = body;
  if (!start || !end) {
    return NextResponse.json(
      { error: "start and end (YYYY-MM-DD) required" },
      { status: 400 },
    );
  }
  try {
    const result = await backfillRange(start, end);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
