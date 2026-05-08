import { NextResponse } from "next/server";
import { refreshAndSyncAllUpstream } from "@/lib/sync";

export const runtime = "nodejs";
// Sequentially-batched refresh + sync per upstream — wide budget so a slow
// upstream doesn't time out the whole request.
export const maxDuration = 300;

export async function POST() {
  const r = await refreshAndSyncAllUpstream();
  return NextResponse.json(r);
}
