import { NextResponse } from "next/server";
import baseline from "@/data/bench-baseline-official-n30.json";

export const runtime = "nodejs";

// Returns the vendored official baseline (n=30, seed=42, opus-4-7, effort=high)
// for client-side comparison. Static — never re-fetches.
export async function GET() {
  return NextResponse.json(baseline);
}
