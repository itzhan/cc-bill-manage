import { NextResponse } from "next/server";
import { refreshAll } from "@/lib/sync";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST() {
  const r = await refreshAll();
  return NextResponse.json(r);
}
